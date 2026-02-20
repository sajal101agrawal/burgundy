export default function RegisterPage() {
  return (
    <main>
      <section className="hero">
        <span className="badge">Registration</span>
        <h1>Bring your concierge online</h1>
        <p>
          Capture the essentials now, and let the agent collect the rest lazily as
          it works.
        </p>
      </section>
      <section className="card-grid">
        <div className="card">
          <h3>Persona</h3>
          <p>Name, communication style, and language preferences.</p>
        </div>
        <div className="card">
          <h3>Contact</h3>
          <p>Primary WhatsApp number for routing and OTP relay.</p>
        </div>
        <div className="card">
          <h3>Optional Profile</h3>
          <p>Provide company, roles, and preferences or skip for later.</p>
        </div>
      </section>
    </main>
  );
}
