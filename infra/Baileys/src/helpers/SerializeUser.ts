import Queue from "../models/Queue";
import Company from "../models/Company";
import User from "../models/User";
import Setting from "../models/Setting";

interface SerializedUser {
  id: number;
  name: string;
  email: string;
  profile: string;
  companyId: number;
  company: Company | null;
  super: boolean;
  queues: Queue[];
  allTicket: string;
  avatar: string;
  defaultRoute: string | null;
  pageAccess: { granted: string[]; denied: string[] } | null;
}

export const SerializeUser = async (user: User): Promise<SerializedUser> => {
  const u = user as any;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    profile: user.profile,
    companyId: user.companyId,
    company: user.company,
    super: user.super,
    queues: user.queues || [],
    allTicket: u.allTicket ?? "",
    avatar: u.avatar ?? null,
    defaultRoute: u.defaultRoute ?? null,
    pageAccess: u.pageAccess ?? null,
  };
};
