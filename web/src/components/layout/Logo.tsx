import Link from "next/link";
import Image from "next/image";

export function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/tickets" className="block px-1" aria-label="Computicket">
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
        <span className="block text-center text-[17px] font-bold uppercase leading-none tracking-[0.14em] text-[#0e9af8]">
          COMPUTICKET
        </span>
      )}
    </Link>
  );
}
