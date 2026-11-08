import {HugeiconsIcon, type IconSvgElement} from "@hugeicons/react";
import {
  Home01Icon,
  Settings02Icon,
  Tick02Icon,
  Shield01Icon,
  Clock01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  UserGroupIcon,
  CancelCircleIcon,
  Copy01Icon,
  AiMagicIcon,
  Logout01Icon,
  Mail01Icon,
  TaskDone01Icon,
  MoneySend01Icon,
  TransactionHistoryIcon,
  UnfoldMoreIcon,
  PlusSignIcon,
  UserAdd01Icon,
  CpuIcon,
  BankIcon,
  ContactBookIcon,
  Globe02Icon,
  CreditCardIcon,
  SentIcon,
  MoreHorizontalIcon,
  AiChat02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

/** One family across marketing, onboarding and the workspace. Status also has a text label. */
export interface IconProps {
  size?: "nav" | "card";
  className?: string;
}

function Glyph({size = "nav", className, icon}: IconProps & {icon: IconSvgElement}) {
  const px = size === "card" ? 20 : 18;
  return <HugeiconsIcon icon={icon} size={px} className={className} strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" />;
}

export function IconHome(props: IconProps) { return <Glyph {...props} icon={Home01Icon} />; }
export function IconSettings(props: IconProps) { return <Glyph {...props} icon={Settings02Icon} />; }
export function IconCheck(props: IconProps) { return <Glyph {...props} icon={Tick02Icon} />; }
/** Held by policy: protection working, not a failure. */
export function IconShield(props: IconProps) { return <Glyph {...props} icon={Shield01Icon} />; }
export function IconClock(props: IconProps) { return <Glyph {...props} icon={Clock01Icon} />; }
export function IconAlert(props: IconProps) { return <Glyph {...props} icon={AlertCircleIcon} />; }
export function IconArrowRight(props: IconProps) { return <Glyph {...props} icon={ArrowRight01Icon} />; }
export function IconArrowLeft(props: IconProps) { return <Glyph {...props} icon={ArrowLeft01Icon} />; }
export function IconSpenders(props: IconProps) { return <Glyph {...props} icon={UserGroupIcon} />; }
export function IconRevoke(props: IconProps) { return <Glyph {...props} icon={CancelCircleIcon} />; }
export function IconCopy(props: IconProps) { return <Glyph {...props} icon={Copy01Icon} />; }
export function IconAgent(props: IconProps) { return <Glyph {...props} icon={AiMagicIcon} />; }
export function IconSignOut(props: IconProps) { return <Glyph {...props} icon={Logout01Icon} />; }
export function IconMail(props: IconProps) { return <Glyph {...props} icon={Mail01Icon} />; }
/** Navigation symbols stay distinct from inline policy/status/action symbols. */
export function IconApprovals(props: IconProps) { return <Glyph {...props} icon={TaskDone01Icon} />; }
export function IconPayments(props: IconProps) { return <Glyph {...props} icon={MoneySend01Icon} />; }
export function IconHistory(props: IconProps) { return <Glyph {...props} icon={TransactionHistoryIcon} />; }
export function IconSwitch(props: IconProps) { return <Glyph {...props} icon={UnfoldMoreIcon} />; }
export function IconAdd(props: IconProps) { return <Glyph {...props} icon={PlusSignIcon} />; }
export function IconUserAdd(props: IconProps) { return <Glyph {...props} icon={UserAdd01Icon} />; }
export function IconCompute(props: IconProps) { return <Glyph {...props} icon={CpuIcon} />; }
export function IconBank(props: IconProps) { return <Glyph {...props} icon={BankIcon} />; }
export function IconRecipients(props: IconProps) { return <Glyph {...props} icon={ContactBookIcon} />; }
/** The global account (Nuvion): a balance held outside the chain, so a globe, not a bank. */
export function IconGlobal(props: IconProps) { return <Glyph {...props} icon={Globe02Icon} />; }
export function IconCard(props: IconProps) { return <Glyph {...props} icon={CreditCardIcon} />; }
/** Payments abroad. Not `IconPayments`, which is New payment from the account. */
export function IconSendAbroad(props: IconProps) { return <Glyph {...props} icon={SentIcon} />; }
export function IconMore(props: IconProps) { return <Glyph {...props} icon={MoreHorizontalIcon} />; }
export function IconNini(props: IconProps) { return <Glyph {...props} icon={AiChat02Icon} />; }
export function IconClose(props: IconProps) { return <Glyph {...props} icon={Cancel01Icon} />; }
