import Module from "../../models/Module";

interface Result {
  modules: Module[];
  count: number;
}

const ListModulesService = async (): Promise<Result> => {
  const modules = await Module.findAll({
    order: [["name", "ASC"]],
  });
  return {
    modules,
    count: modules.length,
  };
};

export default ListModulesService;
