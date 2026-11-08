/**
 * Nuntio's invite URL, /invite/<token>: the same page as /app/invite/<token> (which keeps working
 * for links shared before). Outside the sign-in gate on purpose: it has to work signed out.
 */
export {default, metadata} from "../../app/invite/[token]/page";
