"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../lib/api";

type Task = {
  id: string;
  goal: string;
  status: string;
  phase: string;
  updatedAt?: string;
  createdAt?: string;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const token = typeof window !== "undefined" ? getToken() : null;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await apiFetch<{ tasks: Task[] }>("/me/tasks", { auth: true });
        setTasks(res.tasks || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <main>
      <section className="hero">
        <span className="badge">Task History</span>
        <h1>Timeline of work</h1>
        <p>Every task is checkpointed and verified before delivery.</p>
      </section>
      {!token ? (
        <section className="card">
          <p>
            Login first in <a href="/settings">Settings</a>.
          </p>
        </section>
      ) : loading ? (
        <section className="card">
          <p>Loading...</p>
        </section>
      ) : error ? (
        <section className="card">
          <p className="error">Error: {error}</p>
        </section>
      ) : tasks.length === 0 ? (
        <section className="card">
          <p>No tasks yet.</p>
        </section>
      ) : (
        <section className="timeline">
          {tasks.map((task) => (
            <div key={task.id} className="timeline-item">
              <strong>{task.goal}</strong>
              <span>
                {task.status} · {task.phase}
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
