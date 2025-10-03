// src/index.ts
import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

/* ---------- 1. 类型声明（让 env 有提示） ---------- */
export interface Env {
  AUTH_STORAGE: KVNamespace;
  AUTH_DB: D1Database;
  RESEND_API_KEY: string;
  FROM_EMAIL?: string;
}

/* ---------- 2. subject 定义 ---------- */
const subjects = createSubjects({
  user: object({
    id: string(),
  }),
});

/* ---------- 3. 邮件发送工厂 ---------- */
function createSendVerificationEmail(env: Env) {
  return async function sendVerificationEmail(email: string, code: string) {
    const RESEND_API_KEY = env.RESEND_API_KEY;
    const FROM_EMAIL = env.FROM_EMAIL || "noreply@yourdomain.com"; // 必须先在 Resend 后台验证

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: "您的验证码 - myAuth",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}
              .container{max-width:600px;margin:0 auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
              .code{font-size:32px;font-weight:bold;color:#0051c3;text-align:center;margin:20px 0;padding:10px;background:#f0f8ff;border-radius:5px}
              .footer{margin-top:30px;font-size:12px;color:#666;text-align:center}
            </style>
          </head>
          <body>
            <div class="container">
              <h2>myAuth 验证码</h2>
              <p>您好！</p>
              <p>您正在尝试登录 myAuth 系统，请使用以下验证码完成验证：</p>
              <div class="code">${code}</div>
              <p>此验证码在 10 分钟内有效。</p>
              <p>如果您没有进行此操作，请忽略此邮件。</p>
              <div class="footer">
                <p>myAuth 系统 &copy; ${new Date().getFullYear()}</p>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Resend error ${resp.status}: ${txt}`);
    }
    console.log(`✅ 验证码 ${code} 已发送至 ${email}`);
  };
}

/* ---------- 4. 用户获取/创建 ---------- */
async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.AUTH_DB.prepare(
    `INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
  )
    .bind(email)
    .first<{ id: string }>();

  if (!result) throw new Error(`Unable to process user: ${email}`);
  console.log(`Found or created user ${result.id} with email ${email}`);
  return result.id;
}

/* ---------- 5. Worker 入口 ---------- */
export default {
  async fetch(request, env: Env, ctx) {
    const url = new URL(request.url);

    /* ---- 演示重定向 ---- */
    if (url.pathname === "/") {
      url.searchParams.set("redirect_uri", url.origin + "/callback");
      url.searchParams.set("client_id", "your-client-id");
      url.searchParams.set("response_type", "code");
      url.pathname = "/authorize";
      return Response.redirect(url.toString());
    }

    if (url.pathname === "/callback") {
      return Response.json({
        message: "OAuth flow complete!",
        params: Object.fromEntries(url.searchParams.entries()),
      });
    }

    /* ---- 核心授权逻辑 ---- */
    return issuer({
      storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            sendCode: createSendVerificationEmail(env), // ✅ 关键修复
            copy: { input_code: "请输入发送到您邮箱的验证码" },
          })
        ),
      },
      theme: {
        title: "myAuth",
        primary: "#0051c3",
        favicon: "https://workers.cloudflare.com/favicon.ico",
        logo: {
          dark: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/db1e5c92-d3a6-4ea9-3e72-155844211f00/public",
          light: "https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fa5a3023-7da9-466b-98a7-4ce01ee6c700/public",
        },
      },
      success: async (ctx, value) => {
        return ctx.subject("user", {
          id: await getOrCreateUser(env, value.email),
        });
      },
    }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
