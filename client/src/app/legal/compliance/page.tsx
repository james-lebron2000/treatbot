import Link from 'next/link';

export default function ComplianceAgreementPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">合规与安全协议</h1>
      <p className="mt-4 text-sm text-gray-700">
        1) 本产品用于临床试验匹配与临床信息结构化提取。使用者应确保其拥有合法授权处理相关医疗数据。
      </p>
      <p className="mt-2 text-sm text-gray-700">
        2) 发送至第三方模型/服务的内容必须不包含患者可识别的个人信息（例如：姓名、电话、身份证号、住址、病案号等）。
      </p>
      <p className="mt-2 text-sm text-gray-700">
        3) 系统会对文本做去标识化处理以降低风险，但仍建议使用者在上传前进行必要的脱敏核查。
      </p>
      <div className="mt-8">
        <Link href="/auth/register" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          返回注册
        </Link>
      </div>
    </div>
  );
}
