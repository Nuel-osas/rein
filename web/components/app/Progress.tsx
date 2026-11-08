"use client";

import type {CSSProperties} from "react";
import {motion, useReducedMotion} from "motion/react";
import styles from "./Progress.module.css";

/** Decorative only: the containing control or status region owns the label. */
export function Spinner() {
  const reduced = useReducedMotion();
  return <motion.span aria-hidden="true" className={styles.spinner}
    animate={{rotate: reduced ? 0 : 360}}
    transition={reduced ? {duration: 0} : {duration: .85, repeat: Infinity, ease: "linear"}} />;
}

export function SkeletonPulse({style}: {style: CSSProperties}) {
  const reduced = useReducedMotion();
  return <motion.span aria-hidden="true" className={styles.skeleton} style={style}
    animate={{opacity: reduced ? 1 : [1, .45, 1]}}
    transition={reduced ? {duration: 0} : {duration: 1.5, repeat: Infinity, ease: "easeInOut"}} />;
}
