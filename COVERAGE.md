# What Keep Playing answers

Keep Playing answers **205 of the 797** PlayFab calls that Microsoft still lists. (Microsoft's description has 843 calls; 46 of them are retired.)

Every answer is checked against Microsoft's description in the tests. Made by `node tools/coverage.js` from [PlayFab/API_Specs](https://github.com/PlayFab/API_Specs) at commit `06cab88` (2026-11-18).

| Area | Working | Calls |
|---|---:|---:|
| Server | 73 | 163 |
| Client | 67 | 174 |
| Admin | 53 | 129 |
| Profile | 5 | 10 |
| Event | 2 | 16 |
| Authentication | 2 | 2 |
| Object | 2 | 2 |
| CloudScript | 1 | 15 |
| MultiplayerServer | 0 | 54 |
| Addon | 0 | 31 |
| Catalog | 0 | 31 |
| Group | 0 | 25 |
| Inventory | 0 | 20 |
| Match | 0 | 20 |
| TrueSkill | 0 | 19 |
| Lobby | 0 | 16 |
| Experimentation | 0 | 13 |
| Leaderboard | 0 | 13 |
| Statistic | 0 | 11 |
| StateShare | 0 | 7 |
| VersionedCatalog | 0 | 7 |
| Insights | 0 | 6 |
| File | 0 | 5 |
| Party | 0 | 3 |
| GameServerIdentity | 0 | 2 |
| Sweepstakes | 0 | 2 |
| Locale | 0 | 1 |
| **All** | **205** | **797** |

## Server

Working: `AddFriend`, `AddOrUpdateContactEmail`, `AddPlayerTag`, `AddSharedGroupMembers`, `AddUserVirtualCurrency`, `AuthenticateSessionTicket`, `BanUsers`, `ConsumeItem`, `CreateSharedGroup`, `DeletePlayer`, `DeleteSharedGroup`, `ExecuteCloudScript`, `GetAllUsersCharacters`, `GetCatalogItems`, `GetFriendLeaderboard`, `GetFriendsList`, `GetLeaderboard`, `GetLeaderboardAroundUser`, `GetPlayerCombinedInfo`, `GetPlayerProfile`, `GetPlayerStatistics`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPlayFabIDsFromServerCustomIDs`, `GetPlayFabIDsFromSteamIDs`, `GetPublisherData`, `GetServerCustomIDsFromPlayFabIDs`, `GetSharedGroupData`, `GetStoreItems`, `GetTime`, `GetTitleData`, `GetTitleInternalData`, `GetTitleNews`, `GetUserAccountInfo`, `GetUserBans`, `GetUserData`, `GetUserInternalData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherInternalData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `GrantItemsToUser`, `LinkServerCustomId`, `LoginWithServerCustomId`, `ModifyItemUses`, `RemoveFriend`, `RemovePlayerTag`, `RemoveSharedGroupMembers`, `RevokeAllBansForUser`, `RevokeInventoryItem`, `RevokeInventoryItems`, `SetFriendTags`, `SetPublisherData`, `SetTitleData`, `SetTitleInternalData`, `SubtractUserVirtualCurrency`, `UnlinkServerCustomId`, `UnlockContainerInstance`, `UnlockContainerItem`, `UpdateAvatarUrl`, `UpdatePlayerStatistics`, `UpdateSharedGroupData`, `UpdateUserData`, `UpdateUserInternalData`, `UpdateUserInventoryItemCustomData`, `UpdateUserPublisherData`, `UpdateUserPublisherInternalData`, `UpdateUserPublisherReadOnlyData`, `UpdateUserReadOnlyData`, `WriteCharacterEvent`, `WritePlayerEvent`, `WriteTitleEvent`

Not yet: AddCharacterVirtualCurrency, AddGenericID, AwardSteamAchievement, DeleteCharacterFromUser, DeletePlayerCustomProperties, DeletePushNotificationTemplate, EvaluateRandomResultTable, ExportPlayersInSegment, GetAllSegments, GetCharacterData, GetCharacterInternalData, GetCharacterInventory, GetCharacterLeaderboard, GetCharacterReadOnlyData, GetCharacterStatistics, GetContentDownloadUrl, GetLeaderboardAroundCharacter, GetLeaderboardForUserCharacters, GetPlayerCustomProperty, GetPlayerSegments, GetPlayFabIDsFromBattleNetAccountIds, GetPlayFabIDsFromFacebookIDs, GetPlayFabIDsFromFacebookInstantGamesIds, GetPlayFabIDsFromGenericIDs, GetPlayFabIDsFromNintendoServiceAccountIds, GetPlayFabIDsFromNintendoSwitchDeviceIds, GetPlayFabIDsFromOpenIdSubjectIdentifiers, GetPlayFabIDsFromPSNAccountIDs, GetPlayFabIDsFromPSNOnlineIDs, GetPlayFabIDsFromSteamNames, GetPlayFabIDsFromTwitchIDs, GetPlayFabIDsFromXboxLiveIDs, GetRandomResultTables, GetSegmentExport, GetSegmentPlayerCount, GrantCharacterToUser, GrantItemsToCharacter, GrantItemsToUsers, LinkBattleNetAccount, LinkNintendoServiceAccount, LinkNintendoServiceAccountSubject, LinkNintendoSwitchDeviceId, LinkPSNAccount, LinkPSNId, LinkSteamId, LinkTwitchAccount, LinkXboxAccount, LinkXboxId, ListPlayerCustomProperties, LoginWithAndroidDeviceID, LoginWithBattleNet, LoginWithCustomID, LoginWithIOSDeviceID, LoginWithNintendoServiceAccount, LoginWithPSN, LoginWithSteamId, LoginWithTwitch, LoginWithXbox, LoginWithXboxId, MoveItemToCharacterFromCharacter, MoveItemToCharacterFromUser, MoveItemToUserFromCharacter, RedeemCoupon, RemoveGenericID, ReportPlayer, RevokeBans, SavePushNotificationTemplate, SendCustomAccountRecoveryEmail, SendEmailFromTemplate, SendPushNotification, SendPushNotificationFromTemplate, SetPlayerSecret, SubtractCharacterVirtualCurrency, UnlinkApple, UnlinkBattleNetAccount, UnlinkFacebookAccount, UnlinkFacebookInstantGamesId, UnlinkGameCenterAccount, UnlinkNintendoServiceAccount, UnlinkNintendoSwitchDeviceId, UnlinkPSNAccount, UnlinkSteamId, UnlinkTwitchAccount, UnlinkXboxAccount, UpdateBans, UpdateCharacterData, UpdateCharacterInternalData, UpdateCharacterReadOnlyData, UpdateCharacterStatistics, UpdatePlayerCustomProperties

## Client

Working: `AddFriend`, `AddOrUpdateContactEmail`, `AddSharedGroupMembers`, `AddUsernamePassword`, `AddUserVirtualCurrency`, `AttributeInstall`, `ConsumeItem`, `CreateSharedGroup`, `ExecuteCloudScript`, `GetAccountInfo`, `GetAllUsersCharacters`, `GetCatalogItems`, `GetFriendLeaderboard`, `GetFriendLeaderboardAroundPlayer`, `GetFriendsList`, `GetLeaderboard`, `GetLeaderboardAroundPlayer`, `GetPlayerCombinedInfo`, `GetPlayerProfile`, `GetPlayerStatistics`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPlayFabIDsFromSteamIDs`, `GetPublisherData`, `GetSharedGroupData`, `GetStoreItems`, `GetTime`, `GetTitleData`, `GetTitleNews`, `GetUserData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `LinkAndroidDeviceID`, `LinkCustomID`, `LinkIOSDeviceID`, `LinkSteamAccount`, `LoginWithAndroidDeviceID`, `LoginWithCustomID`, `LoginWithEmailAddress`, `LoginWithIOSDeviceID`, `LoginWithPlayFab`, `LoginWithSteam`, `PurchaseItem`, `RegisterPlayFabUser`, `RemoveContactEmail`, `RemoveFriend`, `RemoveSharedGroupMembers`, `ReportDeviceInfo`, `SetFriendTags`, `SubtractUserVirtualCurrency`, `UnlinkAndroidDeviceID`, `UnlinkCustomID`, `UnlinkIOSDeviceID`, `UnlinkSteamAccount`, `UnlockContainerInstance`, `UnlockContainerItem`, `UpdateAvatarUrl`, `UpdatePlayerStatistics`, `UpdateSharedGroupData`, `UpdateUserData`, `UpdateUserPublisherData`, `UpdateUserTitleDisplayName`, `WriteCharacterEvent`, `WritePlayerEvent`, `WriteTitleEvent`

Not yet: AcceptTrade, AddGenericID, AndroidDevicePushNotificationRegistration, CancelTrade, ConfirmPurchase, ConsumeMicrosoftStoreEntitlements, ConsumePS5Entitlements, ConsumePSNEntitlements, ConsumeXboxEntitlements, DeletePlayerCustomProperties, GetAdPlacements, GetCharacterData, GetCharacterInventory, GetCharacterLeaderboard, GetCharacterReadOnlyData, GetCharacterStatistics, GetContentDownloadUrl, GetLeaderboardAroundCharacter, GetLeaderboardForUserCharacters, GetPaymentToken, GetPhotonAuthenticationToken, GetPlayerCustomProperty, GetPlayerSegments, GetPlayerTrades, GetPlayFabIDsFromBattleNetAccountIds, GetPlayFabIDsFromFacebookIDs, GetPlayFabIDsFromFacebookInstantGamesIds, GetPlayFabIDsFromGameCenterIDs, GetPlayFabIDsFromGenericIDs, GetPlayFabIDsFromGoogleIDs, GetPlayFabIDsFromGooglePlayGamesPlayerIDs, GetPlayFabIDsFromKongregateIDs, GetPlayFabIDsFromNintendoServiceAccountIds, GetPlayFabIDsFromNintendoSwitchDeviceIds, GetPlayFabIDsFromOpenIdSubjectIdentifiers, GetPlayFabIDsFromPSNAccountIDs, GetPlayFabIDsFromPSNOnlineIDs, GetPlayFabIDsFromSteamNames, GetPlayFabIDsFromTwitchIDs, GetPlayFabIDsFromXboxLiveIDs, GetPurchase, GetTitlePublicKey, GetTradeStatus, GrantCharacterToUser, LinkApple, LinkBattleNetAccount, LinkFacebookAccount, LinkFacebookInstantGamesId, LinkGameCenterAccount, LinkGoogleAccount, LinkGooglePlayGamesServicesAccount, LinkKongregate, LinkNintendoServiceAccount, LinkNintendoSwitchDeviceId, LinkOpenIdConnect, LinkPSNAccount, LinkTwitch, LinkXboxAccount, ListPlayerCustomProperties, LoginWithApple, LoginWithBattleNet, LoginWithFacebook, LoginWithFacebookInstantGamesId, LoginWithGameCenter, LoginWithGoogleAccount, LoginWithGooglePlayGamesServices, LoginWithKongregate, LoginWithNintendoServiceAccount, LoginWithNintendoSwitchDeviceId, LoginWithOpenIdConnect, LoginWithPSN, LoginWithTwitch, LoginWithXbox, OpenTrade, PayForPurchase, RedeemCoupon, RefreshPSNAuthToken, RegisterForIOSPushNotification, RemoveGenericID, ReportAdActivity, ReportPlayer, RestoreIOSPurchases, RewardAdActivity, SendAccountRecoveryEmail, SetPlayerSecret, StartPurchase, UnlinkApple, UnlinkBattleNetAccount, UnlinkFacebookAccount, UnlinkFacebookInstantGamesId, UnlinkGameCenterAccount, UnlinkGoogleAccount, UnlinkGooglePlayGamesServicesAccount, UnlinkKongregate, UnlinkNintendoServiceAccount, UnlinkNintendoSwitchDeviceId, UnlinkOpenIdConnect, UnlinkPSNAccount, UnlinkTwitch, UnlinkXboxAccount, UpdateCharacterData, UpdateCharacterStatistics, UpdatePlayerCustomProperties, ValidateAmazonIAPReceipt, ValidateGooglePlayPurchase, ValidateIOSReceipt, ValidateWindowsStoreReceipt

## Admin

Working: `AddNews`, `AddPlayerTag`, `AddUserVirtualCurrency`, `AddVirtualCurrencyTypes`, `BanUsers`, `CreatePlayerStatisticDefinition`, `DeletePlayer`, `DeleteStore`, `GetCatalogItems`, `GetCloudScriptRevision`, `GetCloudScriptVersions`, `GetPlayerProfile`, `GetPlayerStatisticDefinitions`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPublisherData`, `GetStoreItems`, `GetTitleData`, `GetTitleInternalData`, `GetUserAccountInfo`, `GetUserBans`, `GetUserData`, `GetUserInternalData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherInternalData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `IncrementPlayerStatisticVersion`, `ListVirtualCurrencyTypes`, `RemovePlayerTag`, `RemoveVirtualCurrencyTypes`, `RevokeAllBansForUser`, `RevokeInventoryItem`, `RevokeInventoryItems`, `SetCatalogItems`, `SetPublishedRevision`, `SetPublisherData`, `SetStoreItems`, `SetTitleData`, `SetTitleInternalData`, `SubtractUserVirtualCurrency`, `UpdateCatalogItems`, `UpdateCloudScript`, `UpdatePlayerStatisticDefinition`, `UpdateStoreItems`, `UpdateUserData`, `UpdateUserInternalData`, `UpdateUserPublisherData`, `UpdateUserPublisherInternalData`, `UpdateUserPublisherReadOnlyData`, `UpdateUserReadOnlyData`, `UpdateUserTitleDisplayName`

Not yet: AbortTaskInstance, AddLocalizedNews, CheckLimitedEditionItemAvailability, CreateActionsOnPlayersInSegmentTask, CreateCloudScriptAzureFunctionsTask, CreateCloudScriptTask, CreateInsightsScheduledScalingTask, CreateIPBan, CreateOpenIdConnection, CreatePlayerSharedSecret, CreateSegment, DeleteContent, DeleteEventSink, DeleteMasterPlayerAccount, DeleteMasterPlayerEventData, DeleteMembershipSubscription, DeleteOpenIdConnection, DeletePlayerCustomProperties, DeletePlayerSharedSecret, DeleteSegment, DeleteTask, DeleteTitle, DeleteTitleDataOverride, ExportMasterPlayerData, ExportPlayersInSegment, GetActionsOnPlayersInSegmentTaskInstance, GetAllSegments, GetCloudScriptAzureFunctionsTaskInstance, GetCloudScriptTaskInstance, GetContentList, GetContentUploadUrl, GetDataReport, GetEventSinks, GetIPBansForIP, GetIPBansForTitle, GetPlayedTitleList, GetPlayerCustomProperty, GetPlayerIdFromAuthToken, GetPlayerSegments, GetPlayerSharedSecrets, GetPolicy, GetRandomResultTables, GetSegmentExport, GetSegmentPlayerCount, GetSegments, GetStoreMetrics, GetTaskInstances, GetTasks, GrantItemsToUsers, IncrementLimitedEditionItemAvailability, ListOpenIdConnection, ListPlayerCustomProperties, RefundPurchase, ResetCharacterStatistics, ResetPassword, ResetUserStatistics, ResolvePurchaseDispute, RevokeBans, RevokeIPBan, RunTask, SendAccountRecoveryEmail, SetEventSink, SetMembershipOverride, SetPlayerSecret, SetTitleDataAndOverrides, SetupPushNotification, UpdateBans, UpdateIPBan, UpdateOpenIdConnection, UpdatePlayerCustomProperties, UpdatePlayerSharedSecret, UpdatePolicy, UpdateRandomResultTables, UpdateSegment, UpdateTask, ValidateApiPolicy

## Profile

Working: `GetProfile`, `GetProfiles`, `GetTitlePlayersFromMasterPlayerAccountIds`, `SetDisplayName`, `SetProfileLanguage`

Not yet: GetGlobalPolicy, GetTitlePlayersFromXboxLiveIDs, SetAvatarUrl, SetGlobalPolicy, SetProfilePolicy

## Event

Working: `WriteEvents`, `WriteTelemetryEvents`

Not yet: CreateTelemetryKey, DeleteDataConnection, DeleteEventSamplingRatio, DeleteTelemetryKey, GetDataConnection, GetEventSamplingRatio, GetEventSamplingRatios, GetTelemetryKey, ListDataConnections, ListTelemetryKeys, SetDataConnection, SetDataConnectionActive, SetEventSamplingRatio, SetTelemetryKeyActive

## Authentication

Working: `GetEntityToken`, `ValidateEntityToken`

## Object

Working: `GetObjects`, `SetObjects`

## CloudScript

Working: `ExecuteEntityCloudScript`

Not yet: ExecuteFunction, GetFunction, ListEventHubFunctions, ListFunctions, ListHttpFunctions, ListQueuedFunctions, PostFunctionResultForEntityTriggeredAction, PostFunctionResultForFunctionExecution, PostFunctionResultForPlayerTriggeredAction, PostFunctionResultForScheduledTask, RegisterEventHubFunction, RegisterHttpFunction, RegisterQueuedFunction, UnregisterFunction

## MultiplayerServer

Not yet: CreateBuildAlias, CreateBuildWithCustomContainer, CreateBuildWithManagedContainer, CreateBuildWithProcessBasedServer, CreateRemoteUser, CreateTitleMultiplayerServersQuotaChange, DeleteAsset, DeleteBuild, DeleteBuildAlias, DeleteBuildRegion, DeleteCertificate, DeleteContainerImageRepository, DeleteRemoteUser, DeleteSecret, EnableMultiplayerServersForTitle, GetAssetDownloadUrl, GetAssetUploadUrl, GetBuild, GetBuildAlias, GetCognitiveServicesLocales, GetCognitiveServicesToken, GetContainerRegistryCredentials, GetMultiplayerServerAndToken, GetMultiplayerServerDetails, GetMultiplayerServerLogs, GetMultiplayerSessionLogsBySessionId, GetRemoteLoginEndpoint, GetTitleEnabledForMultiplayerServersStatus, GetTitleMultiplayerServersQuotaChange, GetTitleMultiplayerServersQuotas, ListArchivedMultiplayerServers, ListAssetSummaries, ListBuildAliases, ListBuildSummariesV2, ListCertificateSummaries, ListContainerImages, ListContainerImageTags, ListMultiplayerServers, ListPartyQosServers, ListQosServersForTitle, ListSecretSummaries, ListTitleMultiplayerServersQuotaChanges, ListVirtualMachineSummaries, RequestMultiplayerServer, RequestMultiplayerServerAndToken, RolloverContainerRegistryCredentials, ShutdownMultiplayerServer, UntagContainerImage, UpdateBuildAlias, UpdateBuildName, UpdateBuildRegion, UpdateBuildRegions, UploadCertificate, UploadSecret

## Addon

Not yet: ConfigurePSNEventStreams, CreateOrUpdateApple, CreateOrUpdateFacebook, CreateOrUpdateFacebookInstantGames, CreateOrUpdateGoogle, CreateOrUpdateKongregate, CreateOrUpdateNintendo, CreateOrUpdatePSN, CreateOrUpdateSteam, CreateOrUpdateToxMod, CreateOrUpdateTwitch, DeleteApple, DeleteFacebook, DeleteFacebookInstantGames, DeleteGoogle, DeleteKongregate, DeleteNintendo, DeletePSN, DeleteSteam, DeleteToxMod, DeleteTwitch, GetApple, GetFacebook, GetFacebookInstantGames, GetGoogle, GetKongregate, GetNintendo, GetPSN, GetSteam, GetToxMod, GetTwitch

## Catalog

Not yet: CreateDraftItem, CreateUploadUrls, CreateView, DeleteEntityItemReviews, DeleteItem, DeleteView, GetCatalogConfig, GetDraftItem, GetDraftItems, GetEntityDraftItems, GetEntityItemReview, GetItem, GetItemContainers, GetItemModerationState, GetItemPublishStatus, GetItemReviews, GetItemReviewSummary, GetItems, GetView, GetViews, PublishDraftItem, ReportItem, ReportItemReview, ReviewItem, SearchItems, SetItemModerationState, SubmitItemReviewVote, TakedownItemReviews, UpdateCatalogConfig, UpdateDraftItem, UpdateView

## Group

Not yet: AcceptGroupApplication, AcceptGroupInvitation, AddMembers, ApplyToGroup, BlockEntity, ChangeMemberRole, CreateGroup, CreateRole, DeleteGroup, DeleteRole, GetGroup, InviteToGroup, IsMember, ListGroupApplications, ListGroupBlocks, ListGroupInvitations, ListGroupMembers, ListMembership, ListMembershipOpportunities, RemoveGroupApplication, RemoveGroupInvitation, RemoveMembers, UnblockEntity, UpdateGroup, UpdateRole

## Inventory

Not yet: AddInventoryItems, DeleteInventoryCollection, DeleteInventoryItems, ExecuteInventoryOperations, ExecuteTransferOperations, GetInventoryCollectionIds, GetInventoryItems, GetInventoryOperationStatus, GetTransactionHistory, PurchaseInventoryItems, RedeemAppleAppStoreInventoryItems, RedeemAppleAppStoreWithJwsInventoryItems, RedeemGooglePlayInventoryItems, RedeemMicrosoftStoreInventoryItems, RedeemNintendoEShopInventoryItems, RedeemPlayStationStoreInventoryItems, RedeemSteamInventoryItems, SubtractInventoryItems, TransferInventoryItems, UpdateInventoryItems

## Match

Not yet: CancelAllMatchmakingTicketsForPlayer, CancelAllServerBackfillTicketsForPlayer, CancelMatchmakingTicket, CancelServerBackfillTicket, CreateMatchmakingTicket, CreateServerBackfillTicket, CreateServerMatchmakingTicket, GetMatch, GetMatchmakingQueue, GetMatchmakingTicket, GetQueueStatistics, GetServerBackfillTicket, JoinMatchmakingTicket, ListMatchmakingQueues, ListMatchmakingTicketsForPlayer, ListServerBackfillTicketsForPlayer, RemoveMatchmakingQueue, SetMatchmakingQueue, SubscribeToMatchmakingResource, UnsubscribeFromMatchmakingResource

## TrueSkill

Not yet: CancelModel, CreateBaseModel, CreateBatchModel, CreateScenario, DeactivateModel, DeleteModel, DeleteScenario, GetModelDetails, GetModelsByScenario, GetPlayerSkill, GetPlayerSkillForConditions, GetPlayerSkillForConditionsFromModel, GetPlayerSkillFromModel, GetScenarioConfiguration, GetScenarioConfigurations, UpdateModel, UpdatePrimaryModel, UpdateScenarioConfiguration, UploadMatchResult

## Lobby

Not yet: CreateLobby, DeleteLobby, FindFriendLobbies, FindLobbies, GetLobby, InviteToLobby, JoinArrangedLobby, JoinLobby, JoinLobbyAsServer, LeaveLobby, LeaveLobbyAsServer, RemoveMember, SubscribeToLobbyResource, UnsubscribeFromLobbyResource, UpdateLobby, UpdateLobbyAsServer

## Experimentation

Not yet: CreateExclusionGroup, CreateExperiment, DeleteExclusionGroup, DeleteExperiment, GetExclusionGroups, GetExclusionGroupTraffic, GetExperiments, GetLatestScorecard, GetTreatmentAssignment, StartExperiment, StopExperiment, UpdateExclusionGroup, UpdateExperiment

## Leaderboard

Not yet: CreateLeaderboardDefinition, DeleteLeaderboardDefinition, DeleteLeaderboardEntries, GetFriendLeaderboardForEntity, GetLeaderboard, GetLeaderboardAroundEntity, GetLeaderboardDefinition, GetLeaderboardForEntities, IncrementLeaderboardVersion, ListLeaderboardDefinitions, UnlinkLeaderboardFromStatistic, UpdateLeaderboardEntries, UpdateLeaderboardDefinition

## Statistic

Not yet: CreateStatisticDefinition, DeleteStatisticDefinition, DeleteStatistics, GetStatisticDefinition, GetStatistics, GetStatisticsForEntities, IncrementStatisticVersion, ListStatisticDefinitions, UpdateStatistics, UnlinkAggregationSourceFromStatistic, UpdateStatisticDefinition

## StateShare

Not yet: CreateLinkForState, CreateState, DeleteLinkForState, DeleteState, GetLinkMetadata, GetState, ListStateIds

## VersionedCatalog

Not yet: CompleteVersionedCatalogUpload, CreateVersionedCatalogUploadURL, DeleteVersionedCatalog, ExportVersionedCatalog, GetVersionedCatalogItem, GetVersionedCatalogUploadStatus, ListVersionedCatalogs

## Insights

Not yet: GetDetails, GetLimits, GetOperationStatus, GetPendingOperations, SetPerformance, SetStorageRetention

## File

Not yet: AbortFileUploads, DeleteFiles, FinalizeFileUploads, GetFiles, InitiateFileUploads

## Party

Not yet: EnablePartiesForTitle, RequestParty, RequestPartyService

## GameServerIdentity

Not yet: AuthenticateGameServerWithCustomId, Delete

## Sweepstakes

Not yet: CreateSweepstake, GetSweepstake

## Locale

Not yet: GetLanguageList

