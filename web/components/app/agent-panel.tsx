"use client";

// ┌──────────────────────────────────────────────────────────────────────────────────────────┐
// │ STUB. The agent lane (agent/) builds the real panel; the lead wires it in here.           │
// │ Contract: <AgentPanel teamAddress={team} onActivity={refresh} />                           │
// │   teamAddress  the team PDA, base58                                                        │
// │   onActivity   call after the agent sends a payment, so the view re-reads at once          │
// │ Rendered on the team dashboard, /app/<team>/assistant and /demo.                           │
// │ Do not add app/api/agent/ from this lane.                                                  │
// └──────────────────────────────────────────────────────────────────────────────────────────┘

import styles from "./rein/rein.module.css";

export type AgentPanelProps = {teamAddress: string; onActivity?: () => void};

export function AgentPanel({teamAddress}: AgentPanelProps) {
  return (
    <div className={styles.panel} data-agent-panel="stub" data-team={teamAddress}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Research agent</h2>
        <span className={styles.panelNote}>Coming in this build</span>
      </div>
      <p className={styles.panelNote}>
        The agent will run here: ask it for a service in plain words and it pays inside its policy. Ask for more than its $5 cap and the payment stops on chain,
        under Waiting for the owner, until you approve it.
      </p>
    </div>
  );
}

export default AgentPanel;
