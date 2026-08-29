import {
  ALL_PAGE_KEYS,
  DEFAULT_USER_PAGE_KEYS,
  PAGE_DEFINITIONS,
  PageAccessConfig,
  sanitizePageAccess
} from "../constants/pagePermissions";

type UserLike = {
  profile?: string;
  super?: boolean;
  defaultRoute?: string | null;
  pageAccess?: PageAccessConfig | null;
};

const SORTED_PATH_RULES = [...PAGE_DEFINITIONS].sort(
  (a, b) => b.pathPrefix.length - a.pathPrefix.length
);

export const getEffectivePageKeys = (user: UserLike): Set<string> => {
  if (user?.profile === "admin") {
    return new Set(ALL_PAGE_KEYS);
  }

  const effective = new Set(DEFAULT_USER_PAGE_KEYS);
  const pageAccess = sanitizePageAccess(user?.pageAccess);

  pageAccess?.granted?.forEach(key => effective.add(key));
  pageAccess?.denied?.forEach(key => effective.delete(key));

  return effective;
};

export const canAccessPageKey = (user: UserLike, pageKey: string): boolean => {
  if (user?.profile === "admin") {
    const def = PAGE_DEFINITIONS.find(p => p.key === pageKey);
    if (def?.superOnly && !user?.super) {
      return false;
    }
    return true;
  }

  return getEffectivePageKeys(user).has(pageKey);
};

export const pathToPageKey = (pathname: string): string | null => {
  const path = (pathname || "").split("?")[0].replace(/\/$/, "") || "/";

  for (const def of SORTED_PATH_RULES) {
    if (path === def.pathPrefix || path.startsWith(`${def.pathPrefix}/`)) {
      return def.key;
    }
  }

  return null;
};

const UNGUARDED_PATH_PREFIXES = ["/subscription-expired"];

export const canAccessPath = (user: UserLike, pathname: string): boolean => {
  const path = (pathname || "").split("?")[0];

  if (UNGUARDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return true;
  }

  const pageKey = pathToPageKey(path);
  if (!pageKey) {
    return user?.profile === "admin";
  }

  if (pageKey === "announcements" && !user?.super) {
    return false;
  }

  return canAccessPageKey(user, pageKey);
};

export const getFirstAccessiblePath = (user: UserLike): string => {
  const defaultRoute =
    typeof user?.defaultRoute === "string" ? user.defaultRoute.trim() : "";

  if (defaultRoute) {
    const path = `/${defaultRoute}`;
    if (canAccessPath(user, path)) {
      return path;
    }
  }

  const preferred = [
    "/tickets",
    "/dashboard",
    "/pedidos",
    "/cozinha",
    "/garcom",
    "/entregador",
    "/forms",
    "/contacts"
  ];

  for (const path of preferred) {
    if (canAccessPath(user, path)) {
      return path;
    }
  }

  for (const def of PAGE_DEFINITIONS) {
    if (canAccessPageKey(user, def.key)) {
      return def.pathPrefix;
    }
  }

  return "/tickets";
};
