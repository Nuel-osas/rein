"use client";

import {AgentPanel} from "../agent-panel";
import {PageHeader} from "../PageHeader";
import {useTeamPage} from "../rein/context";
import styles from "../rein/rein.module.css";

export function Assistant() {
  const t = useTeamPage();
  return (
    <div className={styles.section}>
      <PageHeader
        kind="assistant"
        title="Assistant"
        description="An AI agent that pays for services in plain words. Its key holds no money: inside its policy it pays at once, and over a limit the payment stops on chain until the owner approves it."
      />
      <AgentPanel teamAddress={t.address} onActivity={() => void t.refresh()} />
    </div>
  );
}
