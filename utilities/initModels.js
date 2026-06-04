// utilities/initModels.js
const AnnouncementFactory = require("../models/announcementModel");
const AnnouncementUserFactory = require("../models/announcementUserModel");
const BranchFactory = require("../models/branchModel");
const BusAccountCutFactory = require("../models/busAccountCutModel");
const BusFactory = require("../models/busModel");
const BusModelFactory = require("../models/busModelModel");
const BusTransactionFactory = require("../models/busTransactionModel");
const CargoFactory = require("../models/cargoModel");
const CashRegisterFactory = require("../models/cashRegisterModel");
const CustomerFactory = require("../models/customerModel");
const FirmFactory = require("../models/firmModel");
const FirmUserFactory = require("../models/firmUserModel");
const FirmUserPermissionFactory = require("../models/firmUserPermissionModel");
const PaymentFactory = require("../models/paymentModel");
const PermissionFactory = require("../models/permissionModel");
const PlaceFactory = require("../models/placeModel");
const PriceFactory = require("../models/priceModel");
const RouteFactory = require("../models/routeModel");
const RouteStopFactory = require("../models/routeStopModel");
const RouteStopRestrictionFactory = require("../models/routeStopRestrictionModel");
const StaffFactory = require("../models/staffModel");
const StopFactory = require("../models/stopModel");
const TakeOnFactory = require("../models/takeOnModel");
const TakeOffFactory = require("../models/takeOffModel");
const SystemLogFactory = require("../models/systemLogModel");
const TicketGroupFactory = require("../models/ticketGroupModel");
const TicketFactory = require("../models/ticketModel");
const TripStopTimeFactory = require("../models/tripStopTimeModel");
const TransactionFactory = require("../models/transactionModel");
const TripFactory = require("../models/tripModel");
const TripNoteFactory = require("../models/tripNoteModel");

function initModels(sequelize) {
  const Announcement = AnnouncementFactory(sequelize);
  const AnnouncementUser = AnnouncementUserFactory(sequelize);
  const Branch = BranchFactory(sequelize);
  const BusAccountCut = BusAccountCutFactory(sequelize);
  const Bus = BusFactory(sequelize);
  const BusModel = BusModelFactory(sequelize);
  const BusTransaction = BusTransactionFactory(sequelize);
  const Cargo = CargoFactory(sequelize);
  const CashRegister = CashRegisterFactory(sequelize);
  const Customer = CustomerFactory(sequelize);
  const FirmUser = FirmUserFactory(sequelize);
  const FirmUserPermission = FirmUserPermissionFactory(sequelize);
  const Payment = PaymentFactory(sequelize);
  const Permission = PermissionFactory(sequelize);
  const Price = PriceFactory(sequelize);
  const Route = RouteFactory(sequelize);
  const RouteStop = RouteStopFactory(sequelize);
  const RouteStopRestriction = RouteStopRestrictionFactory(sequelize);
  const Staff = StaffFactory(sequelize);
  const Stop = StopFactory(sequelize);
  const TakeOn = TakeOnFactory(sequelize);
  const TakeOff = TakeOffFactory(sequelize);
  const SystemLog = SystemLogFactory(sequelize);
  const TicketGroup = TicketGroupFactory(sequelize);
  const Ticket = TicketFactory(sequelize);
  const Transaction = TransactionFactory(sequelize);
  const Trip = TripFactory(sequelize);
  const TripNote = TripNoteFactory(sequelize);
  const TripStopTime = TripStopTimeFactory(sequelize);

  Announcement.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
  Branch.hasMany(Announcement, { foreignKey: "branchId", as: "announcements" });

  AnnouncementUser.belongsTo(Announcement, {
    foreignKey: "announcementId",
    as: "announcement",
  });
  AnnouncementUser.belongsTo(FirmUser, {
    foreignKey: "userId",
    as: "firmUser",
  });
  Announcement.hasMany(AnnouncementUser, {
    foreignKey: "announcementId",
    as: "announcementUsers",
  });
  FirmUser.hasMany(AnnouncementUser, {
    foreignKey: "userId",
    as: "announcementUsers",
  });

  Branch.belongsTo(Stop, { foreignKey: "stopId", as: "stop" });
  Branch.belongsTo(Branch, { foreignKey: "mainBranchId", as: "mainBranch" });
  Stop.hasMany(Branch, { foreignKey: "stopId", as: "branches" });
  Branch.hasMany(Branch, { foreignKey: "mainBranchId", as: "subBranches" });

  BusAccountCut.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  BusAccountCut.belongsTo(Stop, { foreignKey: "stopId", as: "stop" });
  Trip.hasMany(BusAccountCut, { foreignKey: "tripId", as: "busAccountCuts" });
  Stop.hasMany(BusAccountCut, { foreignKey: "stopId", as: "busAccountCuts" });

  Bus.belongsTo(BusModel, { foreignKey: "busModelId", as: "busModel" });
  Bus.belongsTo(Staff, { foreignKey: "captainId", as: "captain" });
  BusModel.hasMany(Bus, { foreignKey: "busModelId", as: "buses" });
  Staff.hasMany(Bus, { foreignKey: "captainId", as: "captainedBuses" });

  BusTransaction.belongsTo(Bus, { foreignKey: "busId", as: "bus" });
  BusTransaction.belongsTo(FirmUser, {
    foreignKey: "userId",
    as: "firmUser",
  });
  Bus.hasMany(BusTransaction, { foreignKey: "busId", as: "transactions" });
  FirmUser.hasMany(BusTransaction, {
    foreignKey: "userId",
    as: "busTransactions",
  });

  Cargo.belongsTo(FirmUser, { foreignKey: "userId", as: "firmUser" });
  Cargo.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  Cargo.belongsTo(Stop, { foreignKey: "fromStopId", as: "fromStop" });
  Cargo.belongsTo(Stop, { foreignKey: "toStopId", as: "toStop" });
  FirmUser.hasMany(Cargo, { foreignKey: "userId", as: "cargos" });
  Trip.hasMany(Cargo, { foreignKey: "tripId", as: "cargos" });
  Stop.hasMany(Cargo, { foreignKey: "fromStopId", as: "cargoDepartures" });
  Stop.hasMany(Cargo, { foreignKey: "toStopId", as: "cargoArrivals" });

  CashRegister.belongsTo(FirmUser, {
    foreignKey: "userId",
    as: "firmUser",
  });
  FirmUser.hasMany(CashRegister, {
    foreignKey: "userId",
    as: "cashRegisters",
  });

  FirmUser.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
  Branch.hasMany(FirmUser, { foreignKey: "branchId", as: "firmUsers" });

  FirmUserPermission.belongsTo(FirmUser, {
    foreignKey: "firmUserId",
    as: "firmUser",
  });
  FirmUserPermission.belongsTo(Permission, {
    foreignKey: "permissionId",
    as: "permission",
  });
  FirmUser.hasMany(FirmUserPermission, {
    foreignKey: "firmUserId",
    as: "permissions",
  });
  Permission.hasMany(FirmUserPermission, {
    foreignKey: "permissionId",
    as: "firmUserPermissions",
  });

  Payment.belongsTo(FirmUser, {
    foreignKey: "initiatorId",
    as: "initiator",
  });
  Payment.belongsTo(FirmUser, { foreignKey: "payerId", as: "payer" });
  Payment.belongsTo(FirmUser, { foreignKey: "receiverId", as: "receiver" });
  FirmUser.hasMany(Payment, {
    foreignKey: "initiatorId",
    as: "initiatedPayments",
  });
  FirmUser.hasMany(Payment, {
    foreignKey: "payerId",
    as: "paymentsAsPayer",
  });
  FirmUser.hasMany(Payment, {
    foreignKey: "receiverId",
    as: "paymentsAsReceiver",
  });

  Price.belongsTo(Stop, { foreignKey: "fromStopId", as: "fromStop" });
  Price.belongsTo(Stop, { foreignKey: "toStopId", as: "toStop" });
  Stop.hasMany(Price, { foreignKey: "fromStopId", as: "outgoingPrices" });
  Stop.hasMany(Price, { foreignKey: "toStopId", as: "incomingPrices" });

  Route.belongsTo(Stop, { foreignKey: "fromStopId", as: "fromStop" });
  Route.belongsTo(Stop, { foreignKey: "toStopId", as: "toStop" });
  Stop.hasMany(Route, { foreignKey: "fromStopId", as: "routesFrom" });
  Stop.hasMany(Route, { foreignKey: "toStopId", as: "routesTo" });

  RouteStop.belongsTo(Route, { foreignKey: "routeId", as: "route" });
  RouteStop.belongsTo(Stop, { foreignKey: "stopId", as: "stop" });
  Route.hasMany(RouteStop, { foreignKey: "routeId", as: "stops" });
  Stop.hasMany(RouteStop, { foreignKey: "stopId", as: "routeStops" });

  RouteStopRestriction.belongsTo(Trip, {
    foreignKey: "tripId",
    as: "trip",
  });
  RouteStopRestriction.belongsTo(RouteStop, {
    foreignKey: "fromRouteStopId",
    as: "fromRouteStop",
  });
  RouteStopRestriction.belongsTo(RouteStop, {
    foreignKey: "toRouteStopId",
    as: "toRouteStop",
  });
  Trip.hasMany(RouteStopRestriction, {
    foreignKey: "tripId",
    as: "routeStopRestrictions",
  });
  RouteStop.hasMany(RouteStopRestriction, {
    foreignKey: "fromRouteStopId",
    as: "outgoingRestrictions",
  });
  RouteStop.hasMany(RouteStopRestriction, {
    foreignKey: "toRouteStopId",
    as: "incomingRestrictions",
  });

  SystemLog.belongsTo(FirmUser, {
    foreignKey: "userId",
    as: "firmUser",
  });
  SystemLog.belongsTo(Branch, { foreignKey: "branchId", as: "branch" });
  FirmUser.hasMany(SystemLog, { foreignKey: "userId", as: "systemLogs" });
  Branch.hasMany(SystemLog, { foreignKey: "branchId", as: "systemLogs" });

  TicketGroup.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  Trip.hasMany(TicketGroup, { foreignKey: "tripId", as: "ticketGroups" });

  Ticket.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  Ticket.belongsTo(FirmUser, { foreignKey: "userId", as: "firmUser" });
  Ticket.belongsTo(TicketGroup, {
    foreignKey: "ticketGroupId",
    as: "ticketGroup",
  });
  Ticket.belongsTo(Customer, {
    foreignKey: "customerId",
    as: "customer",
  });
  Ticket.belongsTo(Stop, {
    foreignKey: "fromRouteStopId",
    as: "fromStop",
  });
  Ticket.belongsTo(Stop, {
    foreignKey: "toRouteStopId",
    as: "toStop",
  });
  Trip.hasMany(Ticket, { foreignKey: "tripId", as: "tickets" });
  FirmUser.hasMany(Ticket, { foreignKey: "userId", as: "issuedTickets" });
  TicketGroup.hasMany(Ticket, { foreignKey: "ticketGroupId", as: "tickets" });
  Customer.hasMany(Ticket, { foreignKey: "customerId", as: "tickets" });
  Stop.hasMany(Ticket, { foreignKey: "fromRouteStopId", as: "ticketsFrom" });
  Stop.hasMany(Ticket, { foreignKey: "toRouteStopId", as: "ticketsTo" });

  Transaction.belongsTo(FirmUser, {
    foreignKey: "userId",
    as: "firmUser",
  });
  Transaction.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  FirmUser.hasMany(Transaction, { foreignKey: "userId", as: "transactions" });
  Ticket.hasMany(Transaction, { foreignKey: "ticketId", as: "transactions" });

  Trip.belongsTo(Route, { foreignKey: "routeId", as: "route" });
  Trip.belongsTo(BusModel, { foreignKey: "busModelId", as: "busModel" });
  Trip.belongsTo(Bus, { foreignKey: "busId", as: "bus" });
  Trip.belongsTo(Staff, { foreignKey: "captainId", as: "captain" });
  Trip.belongsTo(Staff, { foreignKey: "driver2Id", as: "driver2" });
  Trip.belongsTo(Staff, { foreignKey: "driver3Id", as: "driver3" });
  Trip.belongsTo(Staff, { foreignKey: "assistantId", as: "assistant" });
  Trip.belongsTo(Staff, { foreignKey: "hostessId", as: "hostess" });
  Route.hasMany(Trip, { foreignKey: "routeId", as: "trips" });
  BusModel.hasMany(Trip, { foreignKey: "busModelId", as: "trips" });
  Bus.hasMany(Trip, { foreignKey: "busId", as: "trips" });
  Staff.hasMany(Trip, { foreignKey: "captainId", as: "captainedTrips" });
  Staff.hasMany(Trip, { foreignKey: "driver2Id", as: "driver2Trips" });
  Staff.hasMany(Trip, { foreignKey: "driver3Id", as: "driver3Trips" });
  Staff.hasMany(Trip, { foreignKey: "assistantId", as: "assistantTrips" });
  Staff.hasMany(Trip, { foreignKey: "hostessId", as: "hostessTrips" });

  TripNote.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TripNote.belongsTo(FirmUser, { foreignKey: "userId", as: "firmUser" });
  Trip.hasMany(TripNote, { foreignKey: "tripId", as: "notes" });
  FirmUser.hasMany(TripNote, { foreignKey: "userId", as: "tripNotes" });

  TripStopTime.belongsTo(Trip, { foreignKey: "tripId", as: "trip" });
  TripStopTime.belongsTo(RouteStop, {
    foreignKey: "routeStopId",
    as: "routeStop",
  });
  Trip.hasMany(TripStopTime, { foreignKey: "tripId", as: "stopTimes" });
  RouteStop.hasMany(TripStopTime, {
    foreignKey: "routeStopId",
    as: "tripStopTimes",
  });

  return {
    Announcement,
    AnnouncementUser,
    Branch,
    BusAccountCut,
    Bus,
    BusModel,
    BusTransaction,
    Cargo,
    CashRegister,
    Customer,
    FirmUser,
    FirmUserPermission,
    Payment,
    Permission,
    Price,
    Route,
    RouteStop,
    RouteStopRestriction,
    Staff,
    Stop,
    TakeOn,
    TakeOff,
    SystemLog,
    TicketGroup,
    Ticket,
    Transaction,
    Trip,
    TripNote,
    TripStopTime,
  };
}

module.exports = initModels;
