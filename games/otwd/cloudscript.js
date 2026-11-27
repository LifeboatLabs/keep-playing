// OVERKILL's The Walking Dead: weekly quests, the wandering NPC and bounties.
//
// Based on OTWDPlayFabEmulator by HW12Dev (MIT licence, see LICENSE in this
// folder): https://github.com/HW12Dev/OTWDPlayFabEmulator. The game logic is
// theirs; this version keeps each player's weekly state in Keep Playing, so it
// survives restarts. The weekly picks use a different random generator, so
// they won't match HW12Dev's server.

// The week, worked out the same way as the original (UTC).
function weekSeed() {
  var now = new Date();
  var jan1st = Date.UTC(now.getUTCFullYear(), 0, 1);
  return now.getUTCFullYear() + "-" + Math.ceil((now.getTime() - jan1st) / 1000 / 60 / 60 / 24 / 7);
}

// A small random number generator that gives the same numbers for the same
// seed, so everyone gets the same quest in a week.
function seeded(seed) {
  var h = 1779033703 ^ seed.length;
  for (var i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var a = h >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randMinMax(rng, min, max) {
  return Math.floor(rng() * (max - min + 1) + min);
}

// Each player's weekly quest state, kept in internal data, which the game
// itself never sees (so it can't trip over a key it doesn't know).
var STATE_KEY = "KeepPlaying_WeeklyQuest";

function readState() {
  var data = server.GetUserInternalData({ PlayFabId: currentPlayerId, Keys: [STATE_KEY] }).Data;
  var state = data[STATE_KEY] ? JSON.parse(data[STATE_KEY].Value) : null;
  return state && state.week === weekSeed() ? state : null;
}

function writeState(state) {
  var data = {};
  data[STATE_KEY] = JSON.stringify(state);
  server.UpdateUserInternalData({ PlayFabId: currentPlayerId, Data: data });
}

// EOTWDPlayFabQuestProgression: "Inactive", "InProgress", "Completed", "Expired", "AwaitingUpdate".
// Like the original, a player with nothing this week gets "Expired".
function questStatus() {
  var state = readState();
  if (!state) return "Expired";
  if (state.status === "InProgress") {
    // The game marks the quest done by saving WeeklyQuestDone in player data.
    var done = server.GetUserData({ PlayFabId: currentPlayerId, Keys: ["WeeklyQuestDone"] }).Data.WeeklyQuestDone;
    if (done && done.LastUpdated >= state.activatedAt) return "Completed";
  }
  return state.status;
}

handlers.GetSeed = function (args, context) {
  return { date: Date.now() };
};

handlers.GetWeeklyQuest = function (args, context) {
  var rng = seeded(weekSeed());
  var questIndex = randMinMax(rng, 1, 14);
  var xp = randMinMax(rng, 3, 5) * 1000;
  var scrap = randMinMax(rng, 10, 20);
  var provisions = randMinMax(rng, 10, 20);
  var equipment = randMinMax(rng, 10, 20);
  var medicine = randMinMax(rng, 10, 20);
  var gold = 0; // the original doesn't know what this is either

  // Indices into /OTWD/Content/Schematics/Quests/QuestRootData.WeeklyMissionRewardList:
  // 0-6 high-end weapons, 7-10 high-end mod cases, 11-17 legendary weapons, 18-21 legendary mod cases.
  var weaponRewards = [];
  if (randMinMax(rng, 1, 10) > 9) {
    weaponRewards.push(randMinMax(rng, 11, 17), randMinMax(rng, 18, 21), randMinMax(rng, 18, 21));
  } else {
    weaponRewards.push(randMinMax(rng, 0, 6), randMinMax(rng, 7, 9), randMinMax(rng, 7, 9));
  }

  return {
    timeLeft: 10000000,
    status: questStatus(),
    quest: {
      WeeklyQuestIndex: questIndex, // the game counts from 1
      WeeklyXPReward: xp,
      "WeeklyScrap/Prov/Equip/Med/Gold": [scrap, provisions, equipment, medicine, gold],
      WeeklyWeaponRewardsIndices: weaponRewards
    }
  };
};

handlers.ActivateWeeklyQuest = function (args, context) {
  writeState({ week: weekSeed(), status: "InProgress", activatedAt: new Date().toISOString() });
  return { status: "InProgress" };
};

var WANDERER_MAPS = [
  "/Game/Schematics/Levels/MainQuests/Georgetown_Laundromat_03.Georgetown_Laundromat_03",
  "/Game/Schematics/Levels/MainQuests/Underpass_Assault_Bandits_01.Underpass_Assault_Bandits_01",
  "/Game/Schematics/Levels/MainQuests/DeptStore_Scavenge_Story_01.DeptStore_Scavenge_Story_01",
  "/Game/Schematics/Levels/MainQuests/Underground_Escape_Story_01.Underground_Escape_Story_01",
  "/Game/Schematics/Levels/MainQuests/DeptStore_Assault_Military_01.DeptStore_Assault_Military_01",
  "/Game/Schematics/Levels/MainQuests/Lincoln_Assault_Story_01.Lincoln_Assault_Story_01"
];

var WANDERER_WEAPONS = [
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/AssaultRifles/CZ805/DWP_CZ805.DWP_CZ805'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/AssaultRifles/AKM/DWP_AKM.DWP_AKM'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/AssaultRifles/G36/DWP_G36.DWP_G36'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/AssaultRifles/M4A1/DWP_M4A1.DWP_M4A1'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/AssaultRifles/SCAR/DWP_SCAR.DWP_SCAR'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Crossbows/Barnett/DWP_Barnett.DWP_Barnett'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Crossbows/Hercules/DWP_Hercules.DWP_Hercules'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Crossbows/Rogue/DWP_Rogue.DWP_Rogue'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Crossbows/Solid/DWP_Solid.DWP_Solid'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Crossbows/TurboGT/DWP_TurboGT.DWP_TurboGT'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/BaseballBat/DWP_BaseballBat.DWP_BaseballBat'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/BaseballBat/Bat_Common/DWP_BaseballBat_Common.DWP_BaseballBat_Common'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/BaseballBat/Bat_Epic/DWP_BaseballBat_Epic.DWP_BaseballBat_Epic'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/FireAxe/DWP_Fireaxe2.DWP_Fireaxe2'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/FireAxe/Axe_Common/DWP_Fireaxe_Common.DWP_Fireaxe_Common'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/FireAxe/Final_Fireaxe/DWP_Fireaxe.DWP_Fireaxe'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Machete/DWP_Machete.DWP_Machete'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Machete/Machete_3/DWP_Machete3.DWP_Machete3'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Machete/Machete_Common/DWP_Machete_Common.DWP_Machete_Common'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Pickaxe/DWP_Pickaxe.DWP_Pickaxe'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Pickaxe/Epic_Rarity/DWP_Pickaxe_Epic.DWP_Pickaxe_Epic'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Pickaxe/Pickaxe_Rare/DWP_Pickaxe_Rare.DWP_Pickaxe_Rare'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Quarterstaff/DWP_Staff.DWP_Staff'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Quarterstaff/Staff_Epic/DWP_Staff_Epic.DWP_Staff_Epic'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Melee/Quarterstaff/Staff_Rare/DWP_Staff_Rare.DWP_Staff_Rare'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Pistols/1911/DWP_1911.DWP_1911'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Pistols/DesertEagle/DWP_DesertEagle.DWP_DesertEagle'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Pistols/Glock17/DWP_Glock17.DWP_Glock17'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Pistols/M92FS/DWP_M92FS.DWP_M92FS'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Pistols/P226/DWP_P226.DWP_P226'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Revolvers/ColtDetective/DWP_ColtDetective.DWP_ColtDetective'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Revolvers/ColtPython/DWP_ColtPython.DWP_ColtPython'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Revolvers/R8/DWP_R8.DWP_R8'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Revolvers/RagingBull/DWP_RagingBull.DWP_RagingBull'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Revolvers/SW29/DWP_SW29.DWP_SW29'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Shotguns/Andersson/DWP_Anderson.DWP_Anderson'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Shotguns/M37/DWP_M37.DWP_M37'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Shotguns/R870/DWP_R870.DWP_R870'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Shotguns/Redhead/DWP_Redhead.DWP_Redhead'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Shotguns/SPAS12/DWP_SPAS12.DWP_SPAS12'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/K23/DWP_K23.DWP_K23'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/Mac10/DWP_Mac10.DWP_Mac10'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/MP5/DWP_MP5.DWP_MP5'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/Scorpion/DWP_Scorpion.DWP_Scorpion'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/Tec9/DWP_Tec9.DWP_Tec9'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Smgs/UMP45/DWP_UMP45.DWP_UMP45'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Snipers/AWM/DWP_AWM.DWP_AWM'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Snipers/M14/DWP_M14.DWP_M14'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Snipers/Model70/DWP_Model70.DWP_Model70'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Snipers/Mosin/DWP_Mosin.DWP_Mosin'",
  "SBZWeaponData'/Game/Schematics/Weapons/PlayerWeapons/Snipers/SVD/DWP_SVD.DWP_SVD'"
];

var WANDERER_ATTACHMENTS = [
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/Competitors/SCH_BarrelExt_Compensator_Competitors.SCH_BarrelExt_Compensator_Competitors'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/EWK/SCH_BarrelExt_Compensator_EWK.SCH_BarrelExt_Compensator_EWK'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/Facepunch/SCH_BarrelExt_Compensator_Facepunch.SCH_BarrelExt_Compensator_Facepunch'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/FunnelOfFun/SCH_BarrelExt_Compensator_FunnelOfFun.SCH_BarrelExt_Compensator_FunnelOfFun'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/IPSC/SCH_BarrelExt_Compensator_IPSC.SCH_BarrelExt_Compensator_IPSC'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/KingsCrown/SCH_BarrelExt_Compensator_KingsCrown.SCH_BarrelExt_Compensator_KingsCrown'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/SharkTeeth/SCH_BarrelExt_Compensator_SharkTeeth.SCH_BarrelExt_Compensator_SharkTeeth'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Compensators/Tactical/SCH_BarrelExt_Compensator_Tactical.SCH_BarrelExt_Compensator_Tactical'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/FlashHiders/PistolFlashHider/SCH_BarrelExt_FlashHider_Pistol.SCH_BarrelExt_FlashHider_Pistol'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/Aurora/SCH_BarrelExtension_Suppressor_Aurora.SCH_BarrelExtension_Suppressor_Aurora'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/Hush/SCH_BarrelExtension_Suppressor_Hush.SCH_BarrelExtension_Suppressor_Hush'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/LowProfile/SCH_BarrelExtension_Suppressor_LowProfile.SCH_BarrelExtension_Suppressor_LowProfile'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/Monolith/SCH_BarrelExtension_Suppressor_Monolith.SCH_BarrelExtension_Suppressor_Monolith'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/Sandman/SCH_BarrelExtension_Suppressor_Sandman.SCH_BarrelExtension_Suppressor_Sandman'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/ShhSuppressor/SCH_BarrelExtension_Suppressor_Shh.SCH_BarrelExtension_Suppressor_Shh'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/SilentKiller/SCH_BarrelExtension_Suppressor_SilentKiller.SCH_BarrelExtension_Suppressor_SilentKiller'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/StandardIssue/SCH_BarrelExtension_Suppressor_StandardIssue.SCH_BarrelExtension_Suppressor_StandardIssue'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/TheBiggerTheBetter/SCH_BarrelExtension_Suppressor_TheBiggerTheBetter.SCH_BarrelExtension_Suppressor_TheBiggerTheBetter'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/BarrelExtensions/Suppressors/Turbo/SCH_BarrelExtension_Suppressor_Turbo.SCH_BarrelExtension_Suppressor_Turbo'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/CrossbowReceiver/Crossbow_CrossbowReceiver_Balanced.Crossbow_CrossbowReceiver_Balanced'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/CrossbowReceiver/Crossbow_CrossbowReceiver_Precision.Crossbow_CrossbowReceiver_Precision'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/CrossbowReceiver/Crossbow_CrossbowReceiver_Skeletal.Crossbow_CrossbowReceiver_Skeletal'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/Riser/Crossbow_Riser_Skeletal.Crossbow_Riser_Skeletal'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/Riser/Crossbow_Riser_Solid.Crossbow_Riser_Solid'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/Riser/Crossbow_Riser_Weighted.Crossbow_Riser_Weighted'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/WheelCam/Balanced/Crossbow_WheelCam_Balanced.Crossbow_WheelCam_Balanced'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/WheelCam/Skeletal/Crossbow_WheelCam_Skeletal.Crossbow_WheelCam_Skeletal'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Crossbow/WheelCam/Solid/Crossbow_WheelCam_Solid.Crossbow_WheelCam_Solid'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/AssaultLight/SCH_Attachment_Gadget_AssaultLight.SCH_Attachment_Gadget_AssaultLight'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/CompactLaserModule/SCH_Attachment_Gadget_CompactLaserModule.SCH_Attachment_Gadget_CompactLaserModule'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/FoxtrotLight/SCH_Attachment_Gadget_FoxtrotLight.SCH_Attachment_Gadget_FoxtrotLight'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/InforceLight/SCH_Attachment_Gadget_InforceLight.SCH_Attachment_Gadget_InforceLight'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/Pec15/SCH_Attachment_Gadget_Pec15.SCH_Attachment_Gadget_Pec15'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/PocketLaser/SCH_Attachment_Gadget_PocketLaser.SCH_Attachment_Gadget_PocketLaser'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/StingrayLaser/SCH_Attachment_Gadget_StingrayLaser.SCH_Attachment_Gadget_StingrayLaser'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Gadgets/TacticalPistolLight/SCH_Attachment_Gadget_TacticalPistolLight.SCH_Attachment_Gadget_TacticalPistolLight'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Mags/Pmag/SCH_Attachment_Mag_Pmag.SCH_Attachment_Mag_Pmag'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Mags/Speedpull/SCH_Attachment_Mag_Speedpull.SCH_Attachment_Mag_Speedpull'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Mags/Troy/SCH_Attachment_Mag_Troy.SCH_Attachment_Mag_Troy'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Mags/Vintage/SCH_Attachment_Mag_Vintage.SCH_Attachment_Mag_Vintage'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Acog/SCH_Sight_Acog.SCH_Sight_Acog'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/CrossbowScope/SCH_Sight_CrossbowScope.SCH_Sight_CrossbowScope'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Holographic/SCH_Sight_Holographic.SCH_Sight_Holographic'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Milspec/SCH_Sight_Milspec.SCH_Sight_Milspec'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/PistolDeltaSight/SCH_Sight_PistolDeltaSight.SCH_Sight_PistolDeltaSight'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/PistolRedDot/SCH_Sight_PistolRedDot.SCH_Sight_PistolRedDot'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/PrecisionScope/SCH_Sight_PrecisionScope.SCH_Sight_PrecisionScope'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/RifleLong10X/SCH_Sight_RifleLong10X.SCH_Sight_RifleLong10X'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/RifleLong6X/SCH_Sight_RifleLong6X.SCH_Sight_RifleLong6X'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Solar/SCH_Sight_Solar.SCH_Sight_Solar'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Speculator/SCH_Sight_Speculator.SCH_Sight_Speculator'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Sights/Vintage/SCH_Sight_Vintage.SCH_Sight_Vintage'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Stocks/FixedStock/SCH_Attachment_Stock_Fixed.SCH_Attachment_Stock_Fixed'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Stocks/FoldingStock/SCH_Attachment_Stock_Folding.SCH_Attachment_Stock_Folding'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Stocks/Tactical/SCH_Attachment_Stock_Tactical.SCH_Attachment_Stock_Tactical'",
  "SBZWeaponPartSchematic'/Game/Schematics/WeaponParts/Attachments/Stocks/TwoPieceStock/SCH_Attachment_Stock_TwoPiece.SCH_Attachment_Stock_TwoPiece'"
];

handlers.GetWeeklyNPC = function (args, context) {
  var rng = seeded(weekSeed());
  var map = WANDERER_MAPS[randMinMax(rng, 0, WANDERER_MAPS.length - 1)];
  var weapons = WANDERER_WEAPONS.slice();
  var attachments = WANDERER_ATTACHMENTS.slice();
  var inventory = [];
  for (var i = 0; i <= 2; i++) {
    var list = i === 2 ? attachments : weapons;
    var pick = randMinMax(rng, 0, list.length - 1);
    inventory.push({ Asset: list[pick] });
    list.splice(pick, 1);
  }
  return {
    timeLeft: 10000000,
    status: "InProgress",
    npc: {
      NPC: "OTWDAICharacterSchematic'/Game/Schematics/AICharacters/AISC_RescuableFollower_WANDERER1.AISC_RescuableFollower_WANDERER1'",
      Map: { Asset: "SBZLevelSchematic'" + map + "'" },
      Inventory: inventory
    }
  };
};

handlers.ActivateWeeklyNPC = function (args, context) {
  return { status: "InProgress" };
};

handlers.GetBounties = function (args, context) {
  return "Expired";
};
