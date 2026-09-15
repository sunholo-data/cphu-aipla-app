/**
 * A tutor's face, so someone scanning a list of tutors identifies one without
 * reading. Decorative (alt="") — the name beside it is the accessible
 * identity — with an initials fallback for the skill-bound tutors that have no
 * persona.
 *
 * The ONE tutor face on the teacher side (2026-09-15). It replaced five
 * copies — the tutor picker, the class list, the inherited-persona card and
 * both research panels — two of which drew the fallback in indigo while the
 * others used the muted token, so the same faceless tutor had two looks
 * depending on the page.
 */
const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

export function TutorFace({
  avatar,
  name,
  size = "md",
}: {
  avatar?: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const box = SIZES[size];
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatar}
      alt=""
      aria-hidden="true"
      className={`${box} shrink-0 rounded-full object-cover`}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-muted font-bold`}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
