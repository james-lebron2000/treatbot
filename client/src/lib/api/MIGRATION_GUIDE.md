// ============================================================================
// API 迁移指南 - 从旧架构到新架构
// ============================================================================
// 本文件展示如何从旧的 API 调用方式迁移到新的统一 API 层
// ============================================================================

/**
 * ❌ 旧方式 - 存在的问题
 */

// 问题 1: 双重解包，容易出错
import axios from 'axios';
const response1 = await axios.get('/api/auth/me');
const user1 = response1.data.data; // 重复的 .data.data

// 问题 2: 缺少类型安全
const response2 = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
const data2 = await response2.json(); // any 类型，没有验证

// 问题 3: 错误处理不一致
try {
  const response3 = await axios.post('/api/auth/register', userData);
  if (!response3.data.success) {
    throw new Error(response3.data.message);
  }
} catch (error) {
  if (error.response?.status === 401) {
    // 手动处理每个错误类型
  } else if (error.response?.status === 500) {
    // ...
  }
}

// 问题 4: 重复的 token 注入逻辑
const token4 = localStorage.getItem('token');
const response4 = await axios.get('/api/patients/123', {
  headers: {
    Authorization: `Bearer ${token4}`,
  },
});

/**
 * ✅ 新方式 - 简洁、类型安全、统一
 */

import { login, getCurrentUser, ApiError } from '@/lib/api';

// 优点 1: 自动解包，直接返回数据
const user = await getCurrentUser();
console.log(user.name); // 类型安全：TypeScript 知道 user 有 name 属性

// 优点 2: Zod 验证请求和响应
try {
  const { token, user } = await login({
    email: 'user@example.com',
    password: 'short', // ❌ Zod 会抛出验证错误："密码至少需要 8 位"
  });
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.message); // "密码至少需要 8 位"
  }
}

// 优点 3: 统一的错误处理，语义化的错误类型判断
try {
  await login({ email, password });
} catch (error) {
  if (error instanceof ApiError) {
    if (error.isAuthError) {
      // 401 - 认证失败，无需手动检查 status === 401
      showToast('邮箱或密码错误');
    } else if (error.isNetworkError) {
      // 网络错误
      showToast('网络连接失败，请检查网络设置');
    } else if (error.isServerError) {
      // 5xx 或网络错误
      showToast('服务器错误，请稍后重试');
    }
  }
}

// 优点 4: 自动注入 token，无需手动处理
// apiClient 会自动从 localStorage 读取 token 并注入到请求头
const patients = await getPatients(); // ✅ 自动包含 Authorization header

/**
 * 迁移步骤
 */

// Step 1: 替换导入
// ❌ 旧：import { apiClient } from '@/lib/api/api';
// ✅ 新：import { login, getCurrentUser } from '@/lib/api';

// Step 2: 使用类型化的 API 函数替代原始 HTTP 调用
// ❌ 旧：await apiClient.post('/auth/login', loginData)
// ✅ 新：await login(loginData)

// Step 3: 移除手动解包逻辑
// ❌ 旧：const user = response.data.data.user
// ✅ 新：const { user } = await login(loginData)

// Step 4: 使用 ApiError 的语义化方法替代 status 判断
// ❌ 旧：if (error.response?.status === 401)
// ✅ 新：if (error.isAuthError)

/**
 * 示例：登录组件迁移
 */

// ❌ 旧实现
import { useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth';

function LoginFormOld() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login: storeLogin } = useAuthStore();

  const handleSubmit = async (email: string, password: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.post('http://localhost:5001/api/auth/login', {
        email,
        password,
      });

      if (response.data.success) {
        const { token, user } = response.data.data;
        storeLogin(token, user);
      } else {
        setError(response.data.message || '登录失败');
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError('邮箱或密码错误');
      } else if (!err.response) {
        setError('网络连接失败');
      } else {
        setError('登录失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  return null;
}

// ✅ 新实现
import { login, ApiError } from '@/lib/api';

function LoginFormNew() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login: storeLogin } = useAuthStore();

  const handleSubmit = async (email: string, password: string) => {
    setLoading(true);
    setError('');
    try {
      // 类型安全 + 自动验证 + 自动解包
      const { token, user } = await login({ email, password });
      storeLogin(token, user);
    } catch (err) {
      // 统一的错误处理
      if (err instanceof ApiError) {
        if (err.isAuthError) {
          setError('邮箱或密码错误');
        } else if (err.isNetworkError) {
          setError('网络连接失败');
        } else {
          setError(err.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return null;
}

/**
 * 总结：新架构的优势
 */

// ✅ 类型安全：所有请求和响应都有 TypeScript 类型
// ✅ 数据验证：Zod 在运行时验证数据格式
// ✅ 消除重复：自动解包、自动注入 token、统一错误处理
// ✅ 语义化：error.isAuthError 比 error.response?.status === 401 更清晰
// ✅ 可维护：修改 API 结构只需改一个地方（schema）
// ✅ 可测试：每个 API 函数独立，易于 mock 和测试
