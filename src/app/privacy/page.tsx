import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <main
      id="main"
      className="mx-auto max-w-2xl px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]"
    >
      <Link href="/chat" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy notice</h1>
      <p className="mt-2 text-sm text-muted-foreground">How {APP_NAME} handles your information.</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_ul]:space-y-1 [&_ul]:text-muted-foreground">
        <section>
          <h2>Who can use this app</h2>
          <p>
            You sign in with your Google account, or with your email and a password. Only email addresses the
            administrator has approved can sign in; nobody can create an account here by themselves.
          </p>
        </section>

        <section>
          <h2>What we store</h2>
          <ul>
            <li>
              Your email address, display name (initially your Google name or the name the administrator gave you) and
              optional bio. We never receive your Google password. If you use a password here, only a one-way
              (bcrypt) hash of it is stored, never the password itself.
            </li>
            <li>Your conversations, messages, attachments, and when messages were delivered and read.</li>
            <li>
              Security logs: sign-ins, sign-outs, access changes and administrator actions. Email addresses in logs are
              partially masked. Message content and verification codes are never logged.
            </li>
          </ul>
        </section>

        <section>
          <h2>How it is protected</h2>
          <ul>
            <li>
              <strong className="text-foreground">In transit:</strong> all traffic uses HTTPS/TLS (and WSS for
              real-time updates).
            </li>
            <li>
              <strong className="text-foreground">At rest:</strong> the database and file storage are hosted by
              Supabase, which encrypts stored data at rest (AES-256) at the infrastructure level.
            </li>
            <li>
              <strong className="text-foreground">Access control:</strong> database rules ensure only the members of a
              conversation can read or send its messages and files. Revoked members lose access immediately.
            </li>
            <li>
              <strong className="text-foreground">Not end-to-end encrypted:</strong> messages are stored on the server
              in a form the server can read. They are not end-to-end encrypted.
            </li>
          </ul>
        </section>

        <section>
          <h2>Administrator access to messages</h2>
          <p>
            By default administrators <strong className="text-foreground">cannot</strong> read message content through
            the app; they see only metadata such as message counts. An administrator can enable message access as an
            explicit policy. When it is enabled, every member sees a notice in the app, and every time an
            administrator views a conversation it is recorded in the audit log. People with direct access to the
            hosting infrastructure (the database owner) can technically access stored data.
          </p>
        </section>

        <section>
          <h2>How long data is kept</h2>
          <p>
            Messages are kept until you delete them, unless the administrator configures a retention period, in which
            case older messages are deleted automatically. Security logs are kept for a limited period configured by
            the administrator (default 365 days).
          </p>
        </section>

        <section>
          <h2>Deleting your data</h2>
          <ul>
            <li>You can delete any message you sent at any time; it is removed for everyone.</li>
            <li>
              To delete your whole account, ask the administrator. Account deletion permanently removes your profile,
              the messages and files you sent, and your sign-in record.
            </li>
            <li>Database backups kept by the hosting provider expire according to their backup schedule.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
