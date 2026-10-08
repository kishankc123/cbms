// Email delivery through Resend's HTTP API (no SDK needed). Configure with:
//   RESEND_API_KEY  — from resend.com
//   EMAIL_FROM      — e.g. "Client Books <noreply@yourdomain.com>" (needs a
//                     verified domain; defaults to Resend's test sender, which
//                     can only deliver to your own Resend account email)
//   APP_URL         — public base URL used in links (default http://localhost:3100)
// With no RESEND_API_KEY the message is printed to the server console instead,
// so every email flow still works locally.

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export type EmailKind = "verification" | "password_reset" | "invitation" | "added_to_organization" | "other";
export type EmailStatus = "sent" | "failed" | "not_configured";
export type SendResult = { delivered: boolean; status: EmailStatus; /** Why it was not delivered, in words a person can act on. */ error?: string };

/**
 * An email that did not go: the provider or the network refused it, or (on the live site) no provider is set up. With no provider
 * set up in development the message is just printed, which is not a problem.
 */
export const isDeliveryFailure = (status: string) => status === "failed" || (status === "not_configured" && process.env.NODE_ENV === "production");

/** A short, plain reason from a provider's error reply. */
function reasonFrom(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string };
    if (j.message) return `${j.message} (${status})`.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return `The email service refused the message (${status}).`;
}

/**
 * Sends one email and records the attempt in the sent-mail log (who, what kind, the outcome; never the body or its links).
 * It never throws: a failure comes back as `delivered: false` with a reason, so the caller can tell the person.
 */
export async function sendEmail(input: { to: string; subject: string; html: string; text: string; kind?: EmailKind; tenantId?: string | null }): Promise<SendResult> {
  const result = await attempt(input);
  try {
    // Imported here so this file stays loadable where there is no database (the pure template helpers below).
    const { db } = await import("@/db");
    const { emailLog } = await import("@/db/schema");
    await db.insert(emailLog).values({ tenantId: input.tenantId ?? null, toEmail: input.to.trim().toLowerCase(), kind: input.kind ?? "other", subject: input.subject, status: result.status, error: result.error ?? null, providerId: result.providerId ?? null });
  } catch (e) {
    console.error("could not write the sent-mail log", e);
  }
  return { delivered: result.delivered, status: result.status, error: result.error };
}

async function attempt(input: { to: string; subject: string; html: string; text: string }): Promise<SendResult & { providerId?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`
[email not configured] To: ${input.to}
Subject: ${input.subject}
${input.text}
`);
    return { delivered: false, status: "not_configured", error: "No email service is set up on this server." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Client Books <onboarding@resend.dev>",
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("Resend error", res.status, body);
      return { delivered: false, status: "failed", error: reasonFrom(res.status, body) };
    }
    let providerId: string | undefined;
    try {
      providerId = (JSON.parse(body) as { id?: string }).id;
    } catch {
      /* the id is only for lookups */
    }
    return { delivered: true, status: "sent", providerId };
  } catch (e) {
    console.error("Email send failed", e);
    return { delivered: false, status: "failed", error: e instanceof Error ? `Could not reach the email service: ${e.message}`.slice(0, 300) : "Could not reach the email service." };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(title: string, body: string, link: string, cta: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111827">
<h2 style="margin:0 0 12px">${esc(title)}</h2><p style="line-height:1.5">${body}</p>
<p><a href="${link}" style="background:#4169e1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(cta)}</a></p>
<p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link:<br>${link}</p></div>`;
}

export function verificationEmail(name: string, link: string) {
  return {
    subject: "Verify your email — Client Books",
    html: layout("Verify your email", `Hi ${esc(name)}, please confirm this is your email address.`, link, "Verify email"),
    text: `Hi ${name}, verify your email: ${link}`,
  };
}

export function passwordResetEmail(link: string) {
  return {
    subject: "Reset your password — Client Books",
    html: layout("Reset your password", "We received a request to reset your password. This link expires in 1 hour. If you didn't ask for this, ignore this email.", link, "Reset password"),
    text: `Reset your password (valid 1 hour): ${link}`,
  };
}

export function addedToOrganizationEmail(orgName: string, adderName: string, roleLabel: string, link: string) {
  return {
    subject: `You've been added to ${orgName} — Client Books`,
    html: layout(`You're now part of ${esc(orgName)}`, `${esc(adderName)} added you to <b>${esc(orgName)}</b> as <b>${esc(roleLabel)}</b>. You can sign in with your existing email and password; if this isn't expected you can leave the organization from your account.`, link, "Open Client Books"),
    text: `${adderName} added you to ${orgName} as ${roleLabel}. Sign in with your existing account: ${link}`,
  };
}

export function invitationEmail(orgName: string, inviterName: string, roleLabel: string, link: string) {
  return {
    subject: `You've been invited to ${orgName} — Client Books`,
    html: layout(`Join ${esc(orgName)}`, `${esc(inviterName)} invited you to <b>${esc(orgName)}</b> as <b>${esc(roleLabel)}</b>. This invitation expires in 7 days.`, link, "View invitation"),
    text: `${inviterName} invited you to ${orgName} as ${roleLabel}. Open: ${link}`,
  };
}
