"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../lib/api";

type Task = {
  id: string;
  goal: string;
  status: string;
  phase: string;
  updatedAt?: string;
};

export default function DashboardPage() {
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

  const active = tasks.find((t) => t.status === "active") || null;

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
          {!token ? (
            <p>
              Login first in <a href="/settings">Settings</a>.
            </p>
          ) : loading ? (
            <p>Loading...</p>
          ) : error ? (
            <p className="error">Error: {error}</p>
          ) : active ? (
            <p>
              <strong>{active.phase}</strong>: {active.goal}
            </p>
          ) : (
            <p>No active task.</p>
          )}
        </div>
        <div className="card">
          <h3>Queue</h3>
          {!token ? <p>—</p> : <p>{Math.max(0, tasks.length - (active ? 1 : 0))} tasks in history.</p>}
        </div>
        <div className="card">
          <h3>Recent Update</h3>
          {!token ? (
            <p>—</p>
          ) : tasks[0] ? (
            <p>
              Latest: <strong>{tasks[0].status}</strong> — {tasks[0].goal}
            </p>
          ) : (
            <p>No tasks yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
