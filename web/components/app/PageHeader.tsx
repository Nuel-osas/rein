import type {ReactNode} from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({kind, title, description, action}: {
  kind: "overview" | "pay" | "approvals" | "activity" | "spenders" | "settings" | "teams" | "compute";
  title: string;
  /** A sentence, or a live line such as the dashboard's "read at" status. */
  description: ReactNode;
  action?: ReactNode;
}) {
  return <header className={styles.header} data-section={kind}>
    <div className={styles.copy}><h1>{title}</h1><p>{description}</p></div>
    {action ? <div className={styles.action}>{action}</div> : null}
  </header>;
}
