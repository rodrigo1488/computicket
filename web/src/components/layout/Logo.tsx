import Link from "next/link";
import Image from "next/image";

export function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/tickets"
      className={collapsed ? "block px-1" : "flex min-w-0 flex-1 items-center px-1"}
      aria-label="Computicket"
    >
      {collapsed ? (
        <Image
          src="/logo-icon.png"
          alt="Computicket"
          width={80}
          height={67}
          className="mx-auto h-10 w-10 object-contain"
          priority
        />
      ) : (
        <Image
          src="/logo-sidebar.png"
          alt="Computicket — Ticket Management System"
          width={500}
          height={120}
          className="h-auto w-full max-w-[174px] object-contain object-left"
          priority
        />
      )}
    </Link>
  );
}
