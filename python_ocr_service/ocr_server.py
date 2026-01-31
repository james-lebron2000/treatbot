#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import json
import base64
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import traceback
from typing import List

# Optional dependency for PDF rendering (scanned PDFs)
try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

# Import Alibaba Cloud OCR SDK
from alibabacloud_ocr_api20210707.client import Client as ocr_api20210707Client
from alibabacloud_credentials.client import Client as CredentialClient
from alibabacloud_credentials import models as credential_models
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_darabonba_stream.client import Client as StreamClient
from alibabacloud_ocr_api20210707 import models as ocr_api_20210707_models
from alibabacloud_tea_util import models as util_models
from alibabacloud_tea_console.client import Client as ConsoleClient
from alibabacloud_tea_util.client import Client as UtilClient

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

class AlibabaOCRService:
    def __init__(self):
        self.client = None
        access_key = os.environ.get('ALIBABA_ACCESS_KEY_ID')
        access_secret = os.environ.get('ALIBABA_ACCESS_KEY_SECRET')

        if access_key and access_secret:
            try:
                self.client = self.create_client()
                print("Alibaba OCR client initialised.")
            except Exception as error:
                print(f"Failed to initialise Alibaba OCR client: {error}")
                print(traceback.format_exc())
                self.client = None
        else:
            print("Alibaba OCR credentials not configured. Service will operate in fallback mode.")
    
    @staticmethod
    def create_client() -> ocr_api20210707Client:
        """
        使用凭据初始化账号Client
        @return: Client
        @throws Exception
        """
        config = credential_models.Config(
            type='access_key',
            access_key_id=os.environ.get('ALIBABA_ACCESS_KEY_ID'),
            access_key_secret=os.environ.get('ALIBABA_ACCESS_KEY_SECRET'),
        )
        cred = CredentialClient(config)

        credential = cred.get_credential()
        access_key_id = credential.get_access_key_id()
        access_key_secret = credential.get_access_key_secret()
        security_token = credential.get_security_token()
        
        # Create OpenAPI config
        open_api_config = open_api_models.Config(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            security_token=security_token,
            endpoint='ocr-api.cn-hangzhou.aliyuncs.com'
        )
        return ocr_api20210707Client(open_api_config)
    
    def recognize_image_base64(self, image_base64: str) -> dict:
        """
        识别Base64编码的图片
        """
        try:
            if not self.client:
                return {
                    'success': False,
                    'error': 'Alibaba Cloud OCR client not configured',
                    'confidence': 0
                }

            # 检查凭据配置
            if not os.environ.get('ALIBABA_ACCESS_KEY_ID') or \
               not os.environ.get('ALIBABA_ACCESS_KEY_SECRET'):
                return {
                    'success': False,
                    'error': 'Alibaba Cloud credentials not configured',
                    'confidence': 0
                }
            
            # 解码Base64图片数据
            image_data = base64.b64decode(image_base64)
            
            # 创建识别请求
            recognize_all_text_request = ocr_api_20210707_models.RecognizeAllTextRequest(
                body=image_data,
                type='General'
            )
            
            # 创建运行时选项
            runtime = util_models.RuntimeOptions()
            
            # 调用OCR服务
            print(f"Calling Alibaba OCR API with image size: {len(image_data)} bytes")
            resp = self.client.recognize_all_text_with_options(recognize_all_text_request, runtime)
            
            if resp.status_code != 200:
                return {
                    'success': False,
                    'error': f'OCR API returned status {resp.status_code}',
                    'confidence': 0
                }
            
            # 解析响应数据
            ocr_data = resp.body.data if resp.body and resp.body.data else None
            if not ocr_data:
                return {
                    'success': False,
                    'error': 'No OCR data returned from Alibaba API',
                    'confidence': 0
                }
            
            # 提取文本内容
            extracted_text = self.extract_text_from_ocr_data(ocr_data)
            confidence = self.calculate_average_confidence(ocr_data)
            
            print(f"OCR successful - Text length: {len(extracted_text)}, Confidence: {confidence}%")
            
            return {
                'success': True,
                'extractedText': extracted_text,
                'confidence': confidence,
                'requestId': resp.body.request_id if resp.body else None
            }
            
        except Exception as error:
            print(f"Alibaba OCR failed: {str(error)}")
            print(f"Traceback: {traceback.format_exc()}")
            
            return {
                'success': False,
                'error': str(error),
                'confidence': 0
            }

    def recognize_image_bytes(self, image_bytes: bytes) -> dict:
        """
        识别图片二进制数据（PNG/JPG 等）
        """
        try:
            if not self.client:
                return {
                    'success': False,
                    'error': 'Alibaba Cloud OCR client not configured',
                    'confidence': 0
                }

            recognize_all_text_request = ocr_api_20210707_models.RecognizeAllTextRequest(
                body=image_bytes,
                type='General'
            )

            runtime = util_models.RuntimeOptions()
            try:
                runtime.read_timeout = int(os.environ.get('OCR_READ_TIMEOUT_MS', '60000'))
                runtime.connect_timeout = int(os.environ.get('OCR_CONNECT_TIMEOUT_MS', '15000'))
            except Exception:
                pass

            print(f"Calling Alibaba OCR API with image size: {len(image_bytes)} bytes")
            resp = self.client.recognize_all_text_with_options(recognize_all_text_request, runtime)

            if resp.status_code != 200:
                return {
                    'success': False,
                    'error': f'OCR API returned status {resp.status_code}',
                    'confidence': 0
                }

            ocr_data = resp.body.data if resp.body and resp.body.data else None
            if not ocr_data:
                return {
                    'success': False,
                    'error': 'No OCR data returned from Alibaba API',
                    'confidence': 0
                }

            extracted_text = self.extract_text_from_ocr_data(ocr_data)
            confidence = self.calculate_average_confidence(ocr_data)

            return {
                'success': True,
                'extractedText': extracted_text,
                'confidence': confidence,
                'requestId': resp.body.request_id if resp.body else None
            }
        except Exception as error:
            print(f"Alibaba OCR (bytes) failed: {str(error)}")
            print(f"Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'error': str(error),
                'confidence': 0
            }

    def recognize_pdf_bytes(self, pdf_bytes: bytes, max_pages: int = 20, zoom: float = 1.0) -> dict:
        """
        识别 PDF（二进制），用于扫描版 PDF：逐页渲染为图片后做 OCR。
        """
        if fitz is None:
            return {
                'success': False,
                'error': 'PDF rendering library (PyMuPDF) is unavailable',
                'confidence': 0
            }

        try:
            doc = fitz.open(stream=pdf_bytes, filetype='pdf')
            page_count = doc.page_count
            limit = max(1, min(int(max_pages), page_count))

            pages = []
            texts: List[str] = []
            confidences: List[int] = []

            max_image_bytes = int(os.environ.get('OCR_PDF_MAX_IMAGE_BYTES', '4000000'))

            def render_page_bytes(page, base_zoom: float) -> bytes:
                candidates = [1.0, 0.85, 0.7]
                last_bytes = b''
                for factor in candidates:
                    matrix = fitz.Matrix(float(base_zoom) * factor, float(base_zoom) * factor)
                    pix = page.get_pixmap(matrix=matrix, alpha=False)
                    try:
                        last_bytes = pix.tobytes('jpg')
                    except Exception:
                        last_bytes = pix.tobytes('png')
                    if len(last_bytes) <= max_image_bytes:
                        return last_bytes
                return last_bytes

            for index in range(limit):
                page = doc.load_page(index)
                image_bytes = render_page_bytes(page, float(zoom))

                page_result = self.recognize_image_bytes(image_bytes)
                page_text = (page_result.get('extractedText') or '').strip() if page_result.get('success') else ''
                page_conf = int(page_result.get('confidence') or 0) if page_result.get('success') else 0

                pages.append({
                    'page': index + 1,
                    'success': bool(page_result.get('success')),
                    'confidence': page_conf,
                    'extractedText': page_text,
                    'error': page_result.get('error')
                })
                confidences.append(page_conf)
                if page_text:
                    texts.append(page_text)

            combined_text = '\n\n'.join(texts).strip()
            avg_conf = int(sum(confidences) / max(1, len(confidences)))

            warning = None
            if page_count > limit:
                warning = f'PDF 页数较多，仅处理前 {limit} / {page_count} 页'
            if not combined_text:
                warning = warning or 'PDF OCR 未识别到有效文字'

            return {
                'success': bool(combined_text),
                'extractedText': combined_text,
                'confidence': avg_conf,
                'totalPages': page_count,
                'processedPages': limit,
                'pages': pages,
                'warning': warning
            }
        except Exception as error:
            print(f"PDF OCR failed: {str(error)}")
            print(traceback.format_exc())
            return {
                'success': False,
                'error': str(error),
                'confidence': 0
            }
    
    def extract_text_from_ocr_data(self, ocr_data) -> str:
        """
        从OCR数据中提取文本内容
        """
        if not ocr_data:
            return ''
        
        # 1. 优先使用主要内容字段
        if hasattr(ocr_data, 'content') and ocr_data.content:
            return str(ocr_data.content)
        
        # 2. 从子图像信息中提取文本
        text_blocks = []
        
        if hasattr(ocr_data, 'sub_images') and ocr_data.sub_images:
            for sub_image in ocr_data.sub_images:
                # 从BlockInfo中提取文本
                if hasattr(sub_image, 'block_info') and sub_image.block_info and \
                   hasattr(sub_image.block_info, 'block_details') and sub_image.block_info.block_details:
                    for block in sub_image.block_info.block_details:
                        if hasattr(block, 'block_content') and block.block_content:
                            text_blocks.append(str(block.block_content).replace('"', '"'))
                
                # 从KvInfo中提取结构化数据
                if hasattr(sub_image, 'kv_info') and sub_image.kv_info and \
                   hasattr(sub_image.kv_info, 'data') and sub_image.kv_info.data:
                    try:
                        kv_data = sub_image.kv_info.data
                        if isinstance(kv_data, str):
                            kv_data = json.loads(kv_data)
                        
                        if isinstance(kv_data, dict):
                            for value in kv_data.values():
                                if isinstance(value, str) and value.strip():
                                    text_blocks.append(value)
                    except:
                        # 如果解析失败，直接使用原始数据
                        if isinstance(sub_image.kv_info.data, str):
                            text_blocks.append(sub_image.kv_info.data)
        
        return '\n'.join(text_blocks).strip()
    
    def calculate_average_confidence(self, ocr_data) -> int:
        """
        计算平均置信度
        """
        if not ocr_data:
            return 0
        
        confidences = []
        
        # 从子图像的块信息中提取置信度
        if hasattr(ocr_data, 'sub_images') and ocr_data.sub_images:
            for sub_image in ocr_data.sub_images:
                # 从BlockInfo中提取置信度
                if hasattr(sub_image, 'block_info') and sub_image.block_info and \
                   hasattr(sub_image.block_info, 'block_details') and sub_image.block_info.block_details:
                    for block in sub_image.block_info.block_details:
                        if hasattr(block, 'block_confidence') and \
                           isinstance(block.block_confidence, (int, float)) and block.block_confidence > 0:
                            confidences.append(float(block.block_confidence))
                
                # 从质量信息中提取置信度
                if hasattr(sub_image, 'quality_info') and sub_image.quality_info:
                    if hasattr(sub_image.quality_info, 'quality_score') and \
                       isinstance(sub_image.quality_info.quality_score, (int, float)):
                        confidences.append(float(sub_image.quality_info.quality_score))
        
        # 如果没有置信度数据，基于文本长度估算
        if not confidences:
            extracted_text = self.extract_text_from_ocr_data(ocr_data)
            if extracted_text:
                text_length = len(extracted_text)
                if text_length > 100:
                    return 92
                elif text_length > 50:
                    return 88
                elif text_length > 10:
                    return 85
                else:
                    return 70
            return 0
        
        # 计算平均置信度
        avg_confidence = sum(confidences) / len(confidences)
        return int(min(100, max(0, avg_confidence)))

# Global OCR service instance
ocr_service = AlibabaOCRService()

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    access_key = os.environ.get('ALIBABA_ACCESS_KEY_ID')
    access_secret = os.environ.get('ALIBABA_ACCESS_KEY_SECRET')
    configured = bool(access_key and access_secret and ocr_service.client)
    require_credentials = os.environ.get('OCR_REQUIRE_CREDENTIALS', 'false').lower() == 'true'

    payload = {
        "success": configured or not require_credentials,
        "message": "OCR service running" if configured else ("OCR credentials not configured" if require_credentials else "OCR running (credentials missing)"),
        "status": "ok" if configured else ("error" if require_credentials else "degraded"),
        "configuration": {
            "credentialsConfigured": configured,
            "requireCredentials": require_credentials
        }
    }
    return jsonify(payload), (200 if payload["success"] else 503)
    
@app.route('/ocr', methods=['POST'])
@app.route('/api/ocr', methods=['POST'])
def ocr_recognize():
    try:
        # 情况1：multipart/form-data 上传文件
        if 'file' in request.files:
            file = request.files['file']
            if file.filename == '':
                return jsonify({'success': False, 'error': 'Empty filename'}), 400
            file_bytes = file.read()
            filename = (file.filename or '').lower()
            mimetype = (file.mimetype or '').lower()
            is_pdf = mimetype == 'application/pdf' or filename.endswith('.pdf')
        
        # 情况2：application/json 输入 Base64
        elif request.is_json:
            data = request.get_json(silent=True)
            if not data or 'imageBase64' not in data:
                return jsonify({'success': False, 'error': 'Missing imageBase64 in JSON body'}), 400
            image_base64 = data['imageBase64']
            file_bytes = None
            is_pdf = False
        
        else:
            return jsonify({
                'success': False,
                'error': 'Unsupported Content-Type. Use multipart/form-data or JSON.'
            }), 415

        # 调用 OCR 服务
        if file_bytes is not None and is_pdf:
            max_pages = int(os.environ.get('OCR_PDF_MAX_PAGES', '20'))
            zoom = float(os.environ.get('OCR_PDF_ZOOM', '1.0'))
            result = ocr_service.recognize_pdf_bytes(file_bytes, max_pages=max_pages, zoom=zoom)
        else:
            if file_bytes is not None:
                image_base64 = base64.b64encode(file_bytes).decode('utf-8')
            result = ocr_service.recognize_image_base64(image_base64)
        return jsonify(result), (200 if result.get('success') else 500)

    except Exception as e:
        print(f"OCR endpoint error: {e}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Python OCR microservice...")
    print(f"Alibaba Access Key ID: {os.environ.get('ALIBABA_ACCESS_KEY_ID', 'Not configured')}")
    print(f"Alibaba Endpoint: {os.environ.get('ALIBABA_OCR_ENDPOINT', 'ocr-api.cn-hangzhou.aliyuncs.com')}")

    require_credentials = os.environ.get('OCR_REQUIRE_CREDENTIALS', 'false').lower() == 'true'
    if require_credentials and not (os.environ.get('ALIBABA_ACCESS_KEY_ID') and os.environ.get('ALIBABA_ACCESS_KEY_SECRET')):
        print("ERROR: OCR_REQUIRE_CREDENTIALS=true but Alibaba OCR credentials are missing.")
        sys.exit(1)

    port = int(os.environ.get('OCR_PORT', 5002))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

    app.run(host='0.0.0.0', port=port, debug=debug)
