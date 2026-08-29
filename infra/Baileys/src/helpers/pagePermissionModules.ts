import {
  PageAccessConfig,
  PAGE_DEFINITIONS
} from "../constants/pagePermissions";

export type CompanyModuleFlags = {
  hasLanchonetes: boolean;
  hasAgendamento: boolean;
};

export const getModuleFlagsFromSlugs = (slugs: string[]): CompanyModuleFlags => ({
  hasLanchonetes: slugs.includes("lanchonetes"),
  hasAgendamento: slugs.includes("agendamento")
});

export const isPageAvailableForModules = (
  pageKey: string,
  flags: CompanyModuleFlags
): boolean => {
  const def = PAGE_DEFINITIONS.find(p => p.key === pageKey);
  if (!def?.requiredModule) return true;
  if (def.requiredModule === "lanchonetes") return flags.hasLanchonetes;
  if (def.requiredModule === "agendamento") return flags.hasAgendamento;
  return true;
};

export const filterPageAccessForModules = (
  pageAccess: PageAccessConfig | null,
  flags: CompanyModuleFlags
): PageAccessConfig | null => {
  if (!pageAccess) return null;

  const granted = (pageAccess.granted || []).filter(key =>
    isPageAvailableForModules(key, flags)
  );
  const denied = (pageAccess.denied || []).filter(key =>
    isPageAvailableForModules(key, flags)
  );

  if (granted.length === 0 && denied.length === 0) return null;
  return { granted, denied };
};
