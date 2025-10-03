import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
  user: object({
    id: string(),
  }),
});

// 邮件发送函数 - 使用 Resend 服务
async function sendVerificationEmail(email, code, env) {
  try {
    const RESEND_API_KEY = env.RESEND_API_KEY;
    const FROM_EMAIL = env.FROM_EMAIL || 'noreply@rainwish.com.cn';
    
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY 环境变量未设置');
    }
    
    if (!FROM_EMAIL) {
      throw new Error('FROM_EMAIL 环境变量未设置');
    }

    const emailData = {
      from: FROM_EMAIL,
      to: email,
      subject: '您的验证码 - Rainwish Auth',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    background-color: #f5f5f5; 
                    padding: 20px; 
                    margin: 0;
                }
                .container { 
                    max-width: 600px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 10px; 
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
                }
                .code { 
                    font-size: 32px; 
                    font-weight: bold; 
                    color: #0051c3; 
                    text-align: center; 
                    margin: 20px 0; 
                    padding: 15px; 
                    background: #f0f8ff; 
                    border-radius: 5px; 
                    border: 2px dashed #0051c3;
                }
                .footer { 
                    margin-top: 30px; 
                    font-size: 12px; 
                    color: #666; 
                    text-align: center; 
                }
                h2 {
                    color: #0051c3;
                    margin-top: 0;
                }
                p {
                    line-height: 1.6;
                    color: #333;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Rainwish Auth 验证码</h2>
                <p>您好！</p>
                <p>您正在尝试登录 Rainwish 系统，请使用以下验证码完成验证：</p>
                <div class="code">${code}</div>
                <p>此验证码在 <strong>10 分钟</strong>内有效。</p>
                <p>如果您没有进行此操作，请忽略此邮件。</p>
                <div class="footer">
                    <p>Rainwish 系统 &copy; ${new Date().getFullYear()}</p>
                </div>
            </div>
        </body>
        </html>
      `
    };

    console.log(`准备发送邮件到: ${email}, 发件人: ${FROM_EMAIL}`);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify(emailData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('邮件发送失败 - 状态码:', response.status, '错误信息:', errorText);
      throw new Error(`邮件发送失败: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`邮件发送成功 - 验证码 ${code} 已发送至 ${email}, Resend ID: ${result.id}`);
    return true;
  } catch (error) {
    console.error('发送邮件过程中出错:', error);
    throw new Error(`邮件发送失败: ${error.message}`);
  }
}

async function getOrCreateUser(env, email) {
  try {
    console.log(`正在查找或创建用户: ${email}`);
    
    if (!env.AUTH_DB) {
      throw new Error('AUTH_DB 数据库连接未配置');
    }

    const result = await env.AUTH_DB.prepare(
      `INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
    )
    .bind(email)
    .first();

    if (!result) {
      throw new Error(`无法处理用户: ${email}`);
    }

    console.log(`成功找到或创建用户 ID: ${result.id}, 邮箱: ${email}`);
    return result.id;
  } catch (error) {
    console.error('用户数据库操作失败:', error);
    throw new Error(`用户处理失败: ${error.message}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      console.log('收到请求:', request.method, request.url);
      
      const url = new URL(request.url);
      
      // 🚫 删除所有演示重定向逻辑
      // 生产环境中，认证请求应该由前端应用直接发起到 /authorize 等端点
      
      // 直接进入核心认证逻辑
      return await issuer({
        storage: CloudflareStorage({
          namespace: env.AUTH_STORAGE,
        }),
        subjects,
        providers: {
          password: PasswordProvider(
            PasswordUI({
              sendCode: async (email, code) => {
                console.log(`收到发送验证码请求 - 邮箱: ${email}, 验证码: ${code}`);
                await sendVerificationEmail(email, code, env);
              },
              copy: {
                input_code: "请输入发送到您邮箱的验证码",
                submit_code: "验证",
                sending_code: "正在发送验证码...",
                code_sent: "验证码已发送",
                invalid_code: "验证码无效",
              },
            }),
          ),
        },
        theme: {
          title: "Rainwish Auth",
          primary: "#0051c3",
          favicon: "https://workers.cloudflare.com/favicon.ico",
          logo: {
            dark: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/db1e5c92-d3a6-4ea9-3e72-155844211f00/public",
            light: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fa5a3023-7da9-466b-98a7-4ce01ee6c700/public",
          },
        },
        success: async (ctx, value) => {
          console.log('认证成功，处理用户:', value.email);
          const userId = await getOrCreateUser(env, value.email);
          return ctx.subject("user", { id: userId });
        },
        error: async (ctx, error) => {
          console.error('认证过程中出错:', error);
          return ctx.error('internal_server_error', error.message);
        }
      }).fetch(request, env, ctx);
      
    } catch (error) {
      console.error('Worker 执行过程中发生未捕获的错误:', error);
      return new Response(JSON.stringify({
        error: 'server_error',
        error_description: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
