export default function VaultPage() {
  return (
    <main>
      <section className="hero">
        <span className="badge">Vault</span>
        <h1>Encrypted credentials</h1>
        <p>Manage secrets, sharing rules, and audit access from one place.</p>
      </section>
      <section className="card-grid">
        <div className="card">
          <h3>Netflix</h3>
          <p>Shared with Ops team (view) until March 2026.</p>
        </div>
        <div className="card">
          <h3>AWS</h3>
          <p>Last used by the concierge 2 hours ago.</p>
        </div>
        <div className="card">
          <h3>Salesforce</h3>
          <p>Waiting for OTP to complete login.</p>
        </div>
      </section>
    </main>
  );
}
