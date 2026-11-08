import { NETWORK_NAME } from './network-copy';
import styles from './TestnetMark.module.css';

// What marks this build as a test network, beside the logo and in one quiet line.

export function TestnetTag({ className }: { className?: string }) {
  return (
    <span className={className ? `${styles.tag} ${className}` : styles.tag}>
      <span className={styles.bracket} aria-hidden="true">[</span>
      Devnet
      <span className={styles.bracket} aria-hidden="true">]</span>
    </span>
  );
}

export function TestnetNote({ className }: { className?: string }) {
  return <p className={className ? `${styles.note} ${className}` : styles.note}>{NETWORK_NAME}: free test USDC. Nothing here is real money.</p>;
}

export function TestnetStrip({ className }: { className?: string }) {
  return (
    <p className={className ? `${styles.strip} ${className}` : styles.strip}>
      <span className={styles.stripTag}>
        <span className={styles.bracket} aria-hidden="true">[</span>
        Devnet
        <span className={styles.bracket} aria-hidden="true">]</span>
      </span>
      <span className={styles.stripText}>Test USDC only</span>
    </p>
  );
}
