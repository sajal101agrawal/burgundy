export default function TasksPage() {
  return (
    <main>
      <section className="hero">
        <span className="badge">Task History</span>
        <h1>Timeline of work</h1>
        <p>Every task is checkpointed and verified before delivery.</p>
      </section>
      <section className="timeline">
        <div className="timeline-item">
          <strong>Pitch deck</strong>
          <span>Delivered 18 Feb 2026</span>
        </div>
        <div className="timeline-item">
          <strong>Deploy API</strong>
          <span>Awaiting confirmation</span>
        </div>
        <div className="timeline-item">
          <strong>Invoice audit</strong>
          <span>Completed</span>
        </div>
      </section>
    </main>
  );
}
