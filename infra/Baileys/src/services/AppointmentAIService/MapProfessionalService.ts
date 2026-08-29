import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import User from "../../models/User";

interface MapProfessionalRequest {
  professionalName: string;
  companyId: number;
}

interface MapProfessionalResult {
  professionalId: number;
  professionalName: string;
  found: boolean;
  suggestions?: Array<{ id: number; name: string }>;
}

const MapProfessionalService = async ({
  professionalName,
  companyId
}: MapProfessionalRequest): Promise<MapProfessionalResult> => {
  if (!professionalName || professionalName.trim().length === 0) {
    throw new AppError("Nome do profissional é obrigatório", 400);
  }

  // Normalizar o nome (remover acentos, converter para minúsculas, remover espaços extras)
  const normalizedSearch = professionalName
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Buscar profissionais da empresa
  // Primeiro, tentar busca exata (case-insensitive)
  let professional = await User.findOne({
    where: {
      companyId,
      name: {
        [Op.iLike]: professionalName.trim()
      }
    },
    attributes: ["id", "name"]
  });

  // Se não encontrou exato, tentar busca parcial
  if (!professional) {
    professional = await User.findOne({
      where: {
        companyId,
        name: {
          [Op.iLike]: `%${professionalName.trim()}%`
        }
      },
      attributes: ["id", "name"]
    });
  }

  // Se ainda não encontrou, buscar todos os profissionais para sugerir
  if (!professional) {
    const allProfessionals = await User.findAll({
      where: {
        companyId
      },
      attributes: ["id", "name"],
      limit: 10,
      order: [["name", "ASC"]]
    });

    return {
      professionalId: 0,
      professionalName: professionalName,
      found: false,
      suggestions: allProfessionals.map(p => ({
        id: p.id,
        name: p.name
      }))
    };
  }

  return {
    professionalId: professional.id,
    professionalName: professional.name,
    found: true
  };
};

export default MapProfessionalService;
