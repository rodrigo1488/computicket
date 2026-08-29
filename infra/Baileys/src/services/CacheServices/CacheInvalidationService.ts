import {
  appCache,
  CacheNamespace
} from "../../libs/appCache";

const invalidate = async (
  companyId: number | undefined,
  namespaces: CacheNamespace[],
  userId?: number
): Promise<void> => {
  const tasks: Promise<void>[] = [];
  if (companyId !== undefined) {
    tasks.push(appCache.invalidateCompany(companyId, namespaces));
  }
  if (userId !== undefined) {
    tasks.push(appCache.invalidateUser(userId));
  }
  await Promise.all(tasks);
};

export const onTicketChanged = async (
  companyId: number,
  _ticketId?: number
): Promise<void> => {
  await invalidate(companyId, ["dashboard", "tickets"]);
};

export const onContactChanged = async (
  companyId: number,
  _contactId?: number
): Promise<void> => {
  await invalidate(companyId, ["contacts"]);
};

export const onSettingChanged = async (
  companyId: number,
  _key?: string
): Promise<void> => {
  await appCache.invalidatePattern(`cc:${companyId}:settings*`);
};

export const onModuleChanged = async (companyId: number): Promise<void> => {
  await appCache.invalidatePattern(`cc:${companyId}:modules*`);
  await appCache.invalidatePattern(`cc:${companyId}:module:*`);
};

export const onUserChanged = async (
  userId: number,
  companyId?: number
): Promise<void> => {
  await invalidate(companyId, ["users"], userId);
  await appCache.invalidatePattern(`cc:user:${userId}:*`);
  await appCache.invalidatePattern(`cc:global:users:super:${userId}`);
};

export const onCompanyChanged = async (companyId: number): Promise<void> => {
  await invalidate(companyId, ["company", "dashboard"]);
};

const CacheInvalidationService = {
  onTicketChanged,
  onContactChanged,
  onSettingChanged,
  onModuleChanged,
  onUserChanged,
  onCompanyChanged
};

export default CacheInvalidationService;
