/**
 * A tutor's face, so someone scanning a list of tutors identifies one without
 * reading. Decorative (alt="") — the displayName beside it is the accessible
 * identity — with an initials fallback for the skill-bound tutors that have no
 * persona. Shared by the assign rows and the preview picker (1.1.91), which
 * used to carry one copy each.
 */
export function TutorFace({
  avatar,
  name,
  size = "md",
}: {
  avatar?: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-5 w-5 text-[10px]" : "h-9 w-9 text-xs";
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
