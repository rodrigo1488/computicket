"use client";

import { Eye, MoreVertical, Pencil, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  Children,
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { FloatingMenu } from "@/components/ui/FloatingMenu";

const ActionsMenuContext = createContext(false);

function isEmptyActions(children: ReactNode) {
  const items = Children.toArray(children).filter((c) => c !== "—");
  return items.length === 0;
}

export function RowActions({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (isEmptyActions(children)) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="flex items-center justify-end">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor((cur) => (cur ? null : e.currentTarget));
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-wash"
        aria-label="Ações"
        aria-expanded={!!anchor}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {anchor ? (
        <FloatingMenu
          anchor={anchor}
          align="right"
          width={200}
          onClose={() => setAnchor(null)}
          className="py-1"
        >
          <ActionsMenuContext.Provider value={true}>{children}</ActionsMenuContext.Provider>
        </FloatingMenu>
      ) : null}
    </div>
  );
}

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-muted hover:bg-line disabled:opacity-50";

const menuItem =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-wash disabled:opacity-50";

export function IconAction({
  label,
  icon: Icon,
  href,
  onClick,
  danger,
  className,
  ...props
}: {
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const inMenu = useContext(ActionsMenuContext);
  const cls = inMenu
    ? cn(menuItem, danger && "text-open hover:bg-open/10", className)
    : cn(iconBtn, danger && "text-open hover:bg-open/10", className);

  const content = inMenu ? (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </>
  ) : (
    <Icon className="h-3.5 w-3.5" />
  );

  if (href) {
    if (/^https?:\/\//i.test(href)) {
      return (
        <a href={href} className={cls} aria-label={label} title={label} target="_blank" rel="noreferrer">
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} aria-label={label} title={label}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={label} title={label} {...props}>
      {content}
    </button>
  );
}

export function EditAction(props: { href?: string; onClick?: () => void }) {
  return <IconAction label="Editar" icon={Pencil} {...props} />;
}

export function ViewAction(props: { href?: string; onClick?: () => void }) {
  return <IconAction label="Visualizar" icon={Eye} {...props} />;
}

export function DeleteAction(props: { onClick?: () => void; disabled?: boolean }) {
  return <IconAction label="Excluir" icon={Trash2} danger onClick={props.onClick} disabled={props.disabled} />;
}

export function PrimaryRowAction({
  children,
  onClick,
  disabled,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
}) {
  const inMenu = useContext(ActionsMenuContext);
  const cls = inMenu
    ? menuItem
    : "inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-[13px] font-medium text-on-inverse disabled:opacity-60";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
