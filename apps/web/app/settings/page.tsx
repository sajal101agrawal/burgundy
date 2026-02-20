export default function SettingsPage() {
  return (
    <main>
      <section className="hero">
        <span className="badge">Settings</span>
        <h1>Persona + channels</h1>
        <p>Update assistant style, WhatsApp pairing, and notifications.</p>
      </section>
      <section className="card-grid">
        <div className="card">
          <h3>Persona tone</h3>
          <p>Confident, concise, proactive updates enabled.</p>
        </div>
        <div className="card">
          <h3>WhatsApp</h3>
          <p>Connected to shared platform number.</p>
        </div>
        <div className="card">
          <h3>Notifications</h3>
          <p>Critical-only alerts to WhatsApp and email.</p>
        </div>
      </section>
    </main>
  );
}
