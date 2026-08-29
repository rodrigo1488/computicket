import { Sequelize } from "sequelize-typescript";
import User from "../models/User";
import Setting from "../models/Setting";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import ContactCustomField from "../models/ContactCustomField";
import Message from "../models/Message";
import Queue from "../models/Queue";
import WhatsappQueue from "../models/WhatsappQueue";
import UserQueue from "../models/UserQueue";
import Company from "../models/Company";
import Plan from "../models/Plan";
import TicketNote from "../models/TicketNote";
import QuickMessage from "../models/QuickMessage";
import Help from "../models/Help";
import HelpArticle from "../models/HelpArticle";
import TicketTraking from "../models/TicketTraking";
import UserRating from "../models/UserRating";
import QueueOption from "../models/QueueOption";
import Schedule from "../models/Schedule";
import Tag from "../models/Tag";
import TicketTag from "../models/TicketTag";
import ContactList from "../models/ContactList";
import ContactListItem from "../models/ContactListItem";
import Campaign from "../models/Campaign";
import CampaignSetting from "../models/CampaignSetting";
import Baileys from "../models/Baileys";
import CampaignShipping from "../models/CampaignShipping";
import Announcement from "../models/Announcement";
import Chat from "../models/Chat";
import ChatUser from "../models/ChatUser";
import ChatMessage from "../models/ChatMessage";
import Invoices from "../models/Invoices";
import Subscriptions from "../models/Subscriptions";
import BaileysChats from "../models/BaileysChats";
import Files from "../models/Files";
import FilesOptions from "../models/FilesOptions";
import Prompt from "../models/Prompt";
import QueueIntegrations from "../models/QueueIntegrations";
import { FlowDefaultModel } from "../models/FlowDefault";
import { FlowBuilderModel } from "../models/FlowBuilder";
import { FlowAudioModel } from "../models/FlowAudio";
import { FlowCampaignModel } from "../models/FlowCampaign";
import { FlowImgModel } from "../models/FlowImg";
import Task from "../models/Task";
import UserQuickButton from "../models/UserQuickButton";
import Form from "../models/Form";
import FormField from "../models/FormField";
import FormResponse from "../models/FormResponse";
import ResponseAnswer from "../models/ResponseAnswer";
import UserAppointment from "../models/UserAppointment";
import Product from "../models/Product";
import ProductVariation from "../models/ProductVariation";
import ProductVariationOption from "../models/ProductVariationOption";
import ProductComboItem from "../models/ProductComboItem";
import AddOnGroup from "../models/AddOnGroup";
import AddOnSubgroup from "../models/AddOnSubgroup";
import AddOnItem from "../models/AddOnItem";
import GrupoAddOn from "../models/GrupoAddOn";
import Coupon from "../models/Coupon";
import PrintDevice from "../models/PrintDevice";
import PrintPedido from "../models/PrintPedido";
import Module from "../models/Module";
import CompanyModule from "../models/CompanyModule";
import Mesa from "../models/Mesa";
import MesaOccupationConfirmation from "../models/MesaOccupationConfirmation";
import GourmetFinanceiro from "../models/GourmetFinanceiro";
import GourmetDespesa from "../models/GourmetDespesa";
import AppointmentService from "../models/AppointmentService";
import Appointment from "../models/Appointment";
import AppointmentWaitlist from "../models/AppointmentWaitlist";

// eslint-disable-next-line
const dbConfig = require("../config/database");
// import dbConfig from "../config/database";

const sequelize = new Sequelize(dbConfig);

const models = [
  Company,
  User,
  Contact,
  Ticket,
  Message,
  Whatsapp,
  ContactCustomField,
  Setting,
  Queue,
  WhatsappQueue,
  UserQueue,
  Plan,
  TicketNote,
  QuickMessage,
  Help,
  HelpArticle,
  TicketTraking,
  UserRating,
  QueueOption,
  Schedule,
  Tag,
  TicketTag,
  ContactList,
  ContactListItem,
  Campaign,
  CampaignSetting,
  Baileys,
  CampaignShipping,
  Announcement,
  Chat,
  ChatUser,
  ChatMessage,
  Invoices,
  Subscriptions,
  BaileysChats,
  Files,
  FilesOptions,
  Prompt,
  QueueIntegrations,
  FlowDefaultModel,
  FlowBuilderModel,
  FlowAudioModel,
  FlowCampaignModel,
  FlowImgModel,
  Task,
  UserQuickButton,
  Form,
  FormField,
  FormResponse,
  ResponseAnswer,
  UserAppointment,
  Product,
  ProductVariation,
  ProductVariationOption,
  ProductComboItem,
  AddOnGroup,
  AddOnSubgroup,
  AddOnItem,
  GrupoAddOn,
  Coupon,
  PrintDevice,
  PrintPedido,
  Module,
  CompanyModule,
  Mesa,
  MesaOccupationConfirmation,
  GourmetFinanceiro,
  GourmetDespesa,
  AppointmentService,
  Appointment,
  AppointmentWaitlist,
];

sequelize.addModels(models);

export default sequelize;
