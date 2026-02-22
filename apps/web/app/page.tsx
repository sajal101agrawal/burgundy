export default function Page() {
  return (
    <main>
      <section className="hero">
        <span className="badge">WhatsApp-native AI concierge</span>
        <h1>AI Concierge Platform</h1>
        <p>
          Every user gets a dedicated assistant with its own identity, inbox, and phone
          number. It takes on real digital work, loops in the user only when required,
          and logs every action.
        </p>
        <div className="cta-row">
          <a className="cta" href="/register">
            Start onboarding
          </a>
          <a className="cta secondary" href="/settings">
            Setup keys + WhatsApp
          </a>
          <a className="cta secondary" href="/dashboard">
            View dashboard
          </a>
        </div>
      </section>

      <section className="card-grid">
        <div className="card">
          <h3>Onboarding</h3>
          <p>Provision a private OpenClaw instance and persona in under a minute.</p>
        </div>
        <div className="card">
          <h3>Vault</h3>
          <p>Encrypted credentials with scoped sharing, audit trails, and OTP relay.</p>
        </div>
        <div className="card">
          <h3>Strategy Engine</h3>
          <p>Classify, select tools, validate outputs, and fall back transparently.</p>
        </div>
        <div className="card">
          <h3>Live Routing</h3>
          <p>One shared number, per-user routing, interrupt classification, and queues.</p>
        </div>
      </section>

      <section className="timeline">
        <div className="timeline-item">
          <strong>Week 1–2</strong>
          <span>Monorepo, DB schema, API gateway, OpenClaw fork wired</span>
        </div>
        <div className="timeline-item">
          <strong>Week 3–4</strong>
          <span>Message loop end-to-end with WhatsApp routing</span>
        </div>
        <div className="timeline-item">
          <strong>Week 5–6</strong>
          <span>Vault service, OTP relay, provisioning service</span>
        </div>
      </section>
    </main>
  );
}
