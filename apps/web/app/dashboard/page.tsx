export default function DashboardPage() {
  return (
    <main>
      <section className="hero">
        <span className="badge">Dashboard</span>
        <h1>Live activity</h1>
        <p>Monitor active tasks, queues, and recent concierge actions.</p>
      </section>
      <section className="card-grid">
        <div className="card">
          <h3>Active Task</h3>
          <p>Waiting on user OTP for a Stripe login.</p>
        </div>
        <div className="card">
          <h3>Queue</h3>
          <p>3 new requests scheduled after the current task.</p>
        </div>
        <div className="card">
          <h3>Recent Update</h3>
          <p>Gamma deck generated and shared to WhatsApp.</p>
        </div>
      </section>
    </main>
  );
}
