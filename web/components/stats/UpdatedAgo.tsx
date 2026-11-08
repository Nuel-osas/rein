"use client";

import {useEffect, useState} from "react";
import {ageText} from "./format";

/**
 * "Updated 12 seconds ago", kept true while the page is open.
 *
 * The server renders the age it measured; the browser starts from that same
 * number (so hydration agrees) and adds the time since it mounted.
 */
export function UpdatedAgo({readAt, ageSeconds}: {readAt: number; ageSeconds: number}) {
  const [age, setAge] = useState(ageSeconds);
  useEffect(() => {
    const mounted = Date.now();
    const id = window.setInterval(() => setAge(ageSeconds + (Date.now() - mounted) / 1000), 5_000);
    return () => window.clearInterval(id);
  }, [ageSeconds]);
  return <time dateTime={new Date(readAt).toISOString()}>Updated {ageText(age)}</time>;
}
