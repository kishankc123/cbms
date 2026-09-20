// Email delivery through Resend's HTTP API (no SDK needed). Configure with:
//   RESEND_API_KEY  — from resend.com
//   EMAIL_FROM      — e.g. "Client Books <noreply@yourdomain.com>" (needs a
//                     verified domain; defaults to Resend's test sender, which
//                     can only deliver to your own Resend account email)
//   APP_URL         — public base URL used in links (default http://localhost:3100)
// With no RESEND_API_KEY the message is printed to the server console instead,
// so every email flow still works locally.

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n[email not configured] To: ${input.to}\nSubject: ${input.subject}\n${input.text}\n`);
    return { delivered: false };
  }

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
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text().catch(() => ""));
    return { delivered: false };
  }
  return { delivered: true };
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

export function invitationEmail(orgName: string, inviterName: string, roleLabel: string, link: string) {
  return {
    subject: `You've been invited to ${orgName} — Client Books`,
    html: layout(`Join ${esc(orgName)}`, `${esc(inviterName)} invited you to <b>${esc(orgName)}</b> as <b>${esc(roleLabel)}</b>. This invitation expires in 7 days.`, link, "View invitation"),
    text: `${inviterName} invited you to ${orgName} as ${roleLabel}. Open: ${link}`,
  };
}
