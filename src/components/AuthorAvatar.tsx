"use client";

import { useState } from "react";

export function getAuthorDetails(email: string, providedDisplayName?: string | null) {
  const normalizedDisplayName = providedDisplayName?.trim();
  if (!email && !normalizedDisplayName) return { displayName: "Unknown", initials: "?" };

  const namePart = email.split("@")[0] || "";
  const displayName =
    normalizedDisplayName ||
    namePart
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLocaleLowerCase())
      .join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return {
    displayName: displayName || email,
    initials: initials || "?",
  };
}

type AuthorAvatarProps = {
  email?: string;
  displayName?: string | null;
  src?: string | null;
  size?: number;
};

function AvatarContent({
  src,
  initials,
  size,
}: {
  src?: string | null;
  initials: string;
  size: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!src || imageFailed) return <span aria-hidden="true">{initials}</span>;

  return (
    // The avatar host is instance-configured and constrained by the deployment CSP.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover"
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      onError={() => setImageFailed(true)}
    />
  );
}

export default function AuthorAvatar({
  email = "",
  displayName: providedDisplayName,
  src,
  size = 25,
}: AuthorAvatarProps) {
  const { displayName, initials } = getAuthorDetails(email, providedDisplayName);

  if (!email && !src && !providedDisplayName) return null;

  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-[#1B254B]"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, size * 0.36),
      }}
      title={displayName}
    >
      <AvatarContent key={src ?? "no-avatar"} src={src} initials={initials} size={size} />
      <span className="sr-only">{displayName}</span>
    </span>
  );
}
