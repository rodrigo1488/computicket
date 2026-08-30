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
          src="/logo-light.jpg"
          alt="Computicket"
          width={80}
          height={80}
          className="mx-auto h-10 w-10 object-cover object-top"
          priority
        />
      ) : (
        <Image
          src="/logo-light.jpg"
          alt="Computicket — Ticket Management System"
          width={500}
          height={500}
          className="h-12 w-auto max-w-[168px] object-contain object-left"
          priority
        />
      )}
    </Link>
  );
}
