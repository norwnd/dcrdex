package core

import (
	"fmt"

	"decred.org/dcrdex/client/intl"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

type translation struct {
	subject  intl.Translation
	template intl.Translation
}

const originLang = "en-US"

// originLocale is the American English translations.
var originLocale = map[Topic]*translation{
	TopicAccountRegistered: {
		subject:  intl.Translation{T: "Account registered"},
		template: intl.Translation{T: "You may now trade at %s", Notes: "args: [host]"},
	},
	TopicFeePaymentInProgress: {
		subject:  intl.Translation{T: "Fee payment in progress"},
		template: intl.Translation{T: "Waiting for %d confirmations before trading at %s", Notes: "args: [confs, host]"},
	},
	TopicRegUpdate: {
		subject:  intl.Translation{T: "regupdate"},
		template: intl.Translation{T: "Fee payment confirmations %v/%v", Notes: "args: [confs, required confs]"},
	},
	TopicFeePaymentError: {
		subject:  intl.Translation{T: "Fee payment error"},
		template: intl.Translation{T: "Error encountered while paying fees to %s: %v", Notes: "args: [host, error]"},
	},
	TopicAccountUnlockError: {
		subject:  intl.Translation{T: "Account unlock error"},
		template: intl.Translation{T: "error unlocking account for %s: %v", Notes: "args: [host, error]"},
	},
	TopicFeeCoinError: {
		subject:  intl.Translation{T: "Fee coin error"},
		template: intl.Translation{T: "Empty fee coin for %s.", Notes: "args: [host]"},
	},
	TopicWalletConnectionWarning: {
		subject:  intl.Translation{T: "Wallet connection warning"},
		template: intl.Translation{T: "Incomplete registration detected for %s, but failed to connect to the Decred wallet", Notes: "args: [host]"},
	},
	TopicBondWalletNotConnected: {
		subject:  intl.Translation{T: "Bond wallet not connected"},
		template: intl.Translation{T: "Wallet for selected bond asset %s is not connected"},
	},
	TopicWalletUnlockError: {
		subject:  intl.Translation{T: "Wallet unlock error"},
		template: intl.Translation{T: "Connected to wallet to complete registration at %s, but failed to unlock: %v", Notes: "args: [host, error]"},
	},
	TopicWalletCommsWarning: {
		subject:  intl.Translation{T: "Wallet connection issue"},
		template: intl.Translation{T: "Unable to communicate with %v wallet! Reason: %v", Notes: "args: [asset name, error message]"},
	},
	TopicWalletPeersWarning: {
		subject:  intl.Translation{T: "Wallet network issue"},
		template: intl.Translation{T: "%v wallet has no network peers!", Notes: "args: [asset name]"},
	},
	TopicWalletPeersRestored: {
		subject:  intl.Translation{T: "Wallet connectivity restored"},
		template: intl.Translation{T: "%v wallet has reestablished connectivity.", Notes: "args: [asset name]"},
	},
	TopicSendError: {
		subject:  intl.Translation{T: "Send error"},
		template: intl.Translation{Version: 1, T: "Error encountered while sending %s: %v", Notes: "args: [ticker, error]"},
	},
	TopicSendSuccess: {
		subject:  intl.Translation{T: "Send successful"},
		template: intl.Translation{Version: 1, T: "Sending %s %s to %s has completed successfully. Tx ID = %s", Notes: "args: [value string, ticker, destination address, coin ID]"},
	},
	TopicAsyncOrderFailure: {
		subject:  intl.Translation{T: "In-Flight Order Error"},
		template: intl.Translation{T: "In-Flight order with ID %v failed: %v", Notes: "args: order ID, error]"},
	},
	TopicOrderQuantityTooHigh: {
		subject:  intl.Translation{T: "Trade limit exceeded"},
		template: intl.Translation{T: "Order quantity exceeds current trade limit on %s", Notes: "args: [host]"},
	},
	TopicOrderLoadFailure: {
		subject:  intl.Translation{T: "Order load failure"},
		template: intl.Translation{T: "Some orders failed to load from the database: %v", Notes: "args: [error]"},
	},
	TopicYoloPlaced: {
		subject:  intl.Translation{T: "Market order placed"},
		template: intl.Translation{T: "selling %s %s at market rate (%s)", Notes: "args: [qty, ticker, token]"},
	},
	TopicBuyOrderPlaced: {
		subject:  intl.Translation{T: "Order placed"},
		template: intl.Translation{Version: 1, T: "Buying %s %s, rate = %s (%s)", Notes: "args: [qty, ticker, rate string, token]"},
	},
	TopicSellOrderPlaced: {
		subject:  intl.Translation{T: "Order placed"},
		template: intl.Translation{Version: 1, T: "Selling %s %s, rate = %s (%s)", Notes: "args: [qty, ticker, rate string, token]"},
	},
	TopicMissingMatches: {
		subject:  intl.Translation{T: "Missing matches"},
		template: intl.Translation{T: "%d matches for order %s were not reported by %q and are considered revoked", Notes: "args: [missing count, token, host]"},
	},
	TopicWalletMissing: {
		subject:  intl.Translation{T: "Wallet missing"},
		template: intl.Translation{T: "Wallet retrieval error for active order %s: %v", Notes: "args: [token, error]"},
	},
	TopicMatchErrorCoin: {
		subject:  intl.Translation{T: "Match coin error"},
		template: intl.Translation{T: "Match %s for order %s is in state %s, but has no maker swap coin.", Notes: "args: [side, token, match status]"},
	},
	TopicMatchErrorContract: {
		subject:  intl.Translation{T: "Match contract error"},
		template: intl.Translation{T: "Match %s for order %s is in state %s, but has no maker swap contract.", Notes: "args: [side, token, match status]"},
	},
	TopicMatchRecoveryError: {
		subject:  intl.Translation{T: "Match recovery error"},
		template: intl.Translation{T: "Error auditing counter-party's swap contract (%s %v) during swap recovery on order %s: %v", Notes: "args: [ticker, contract, token, error]"},
	},
	TopicOrderCoinError: {
		subject:  intl.Translation{T: "Order coin error"},
		template: intl.Translation{T: "No funding coins recorded for active order %s", Notes: "args: [token]"},
	},
	TopicOrderCoinFetchError: {
		subject:  intl.Translation{T: "Order coin fetch error"},
		template: intl.Translation{T: "Source coins retrieval error for order %s (%s): %v", Notes: "args: [token, ticker, error]"},
	},
	TopicMissedCancel: {
		subject:  intl.Translation{T: "Missed cancel"},
		template: intl.Translation{T: "Cancel order did not match for order %s. This can happen if the cancel order is submitted in the same epoch as the trade or if the target order is fully executed before matching with the cancel order.", Notes: "args: [token]"},
	},
	TopicBuyOrderCanceled: {
		subject:  intl.Translation{T: "Order canceled"},
		template: intl.Translation{Version: 1, T: "Buy order on %s-%s at %s has been canceled (%s)", Notes: "args: [base ticker, quote ticker, host, token]"},
	},
	TopicSellOrderCanceled: {
		subject:  intl.Translation{T: "Order canceled"},
		template: intl.Translation{Version: 1, T: "Sell order on %s-%s at %s has been canceled (%s)"},
	},
	TopicBuyMatchesMade: {
		subject:  intl.Translation{T: "Matches made"},
		template: intl.Translation{Version: 1, T: "Buy order on %s-%s %.1f%% filled (%s)", Notes: "args: [base ticker, quote ticker, fill percent, token]"},
	},
	TopicSellMatchesMade: {
		subject:  intl.Translation{T: "Matches made"},
		template: intl.Translation{Version: 1, T: "Sell order on %s-%s %.1f%% filled (%s)", Notes: "args: [base ticker, quote ticker, fill percent, token]"},
	},
	TopicSwapSendError: {
		subject:  intl.Translation{T: "Swap send error"},
		template: intl.Translation{T: "Error encountered sending a swap output(s) worth %s %s on order %s", Notes: "args: [qty, ticker, token]"},
	},
	TopicInitError: {
		subject:  intl.Translation{T: "Swap reporting error"},
		template: intl.Translation{T: "Error notifying DEX of swap for match %s: %v", Notes: "args: [match, error]"},
	},
	TopicReportRedeemError: {
		subject:  intl.Translation{T: "Redeem reporting error"},
		template: intl.Translation{T: "Error notifying DEX of redemption for match %s: %v", Notes: "args: [match, error]"},
	},
	TopicSwapsInitiated: {
		subject:  intl.Translation{T: "Swaps initiated"},
		template: intl.Translation{T: "Sent swaps worth %s %s on order %s", Notes: "args: [qty, ticker, token]"},
	},
	TopicRedemptionError: {
		subject:  intl.Translation{T: "Redemption error"},
		template: intl.Translation{T: "Error encountered sending redemptions worth %s %s on order %s", Notes: "args: [qty, ticker, token]"},
	},
	TopicMatchComplete: {
		subject:  intl.Translation{T: "Match complete"},
		template: intl.Translation{T: "Redeemed %s %s on order %s", Notes: "args: [qty, ticker, token]"},
	},
	TopicRefundFailure: {
		subject:  intl.Translation{T: "Refund Failure"},
		template: intl.Translation{T: "Refunded %s %s on order %s, with some errors", Notes: "args: [qty, ticker, token]"},
	},
	TopicMatchesRefunded: {
		subject:  intl.Translation{T: "Matches Refunded"},
		template: intl.Translation{T: "Refunded %s %s on order %s", Notes: "args: [qty, ticker, token]"},
	},
	TopicMatchRevoked: {
		subject:  intl.Translation{T: "Match revoked"},
		template: intl.Translation{T: "Match %s has been revoked", Notes: "args: [match ID token]"},
	},
	TopicOrderRevoked: {
		subject:  intl.Translation{T: "Order revoked"},
		template: intl.Translation{T: "Order %s on market %s at %s has been revoked by the server", Notes: "args: [token, market name, host]"},
	},
	TopicOrderAutoRevoked: {
		subject:  intl.Translation{T: "Order auto-revoked"},
		template: intl.Translation{T: "Order %s on market %s at %s revoked due to market suspension", Notes: "args: [token, market name, host]"},
	},
	TopicMatchRecovered: {
		subject:  intl.Translation{T: "Match recovered"},
		template: intl.Translation{T: "Found maker's redemption (%s: %v) and validated secret for match %s", Notes: "args: [ticker, coin ID, match]"},
	},
	TopicCancellingOrder: {
		subject:  intl.Translation{T: "Cancelling order"},
		template: intl.Translation{T: "A cancel order has been submitted for order %s", Notes: "args: [token]"},
	},
	TopicOrderStatusUpdate: {
		subject:  intl.Translation{T: "Order status update"},
		template: intl.Translation{T: "Status of order %v revised from %v to %v", Notes: "args: [token, old status, new status]"},
	},
	TopicMatchResolutionError: {
		subject:  intl.Translation{T: "Match resolution error"},
		template: intl.Translation{T: "%d matches reported by %s were not found for %s.", Notes: "args: [count, host, token]"},
	},
	TopicFailedCancel: {
		subject: intl.Translation{T: "Failed cancel"},
		template: intl.Translation{
			Version: 1,
			T:       "Cancel order for order %s failed and is now deleted.",
			Notes: `args: [token], "failed" means we missed the preimage request ` +
				`and either got the revoke_order message or it stayed in epoch status for too long.`,
		},
	},
	TopicAuditTrouble: {
		subject:  intl.Translation{T: "Audit trouble"},
		template: intl.Translation{T: "Still searching for counterparty's contract coin %v (%s) for match %s. Are your internet and wallet connections good?", Notes: "args: [coin ID, ticker, match]"},
	},
	TopicDexAuthError: {
		subject:  intl.Translation{T: "DEX auth error"},
		template: intl.Translation{T: "%s: %v", Notes: "args: [host, error]"},
	},
	TopicUnknownOrders: {
		subject:  intl.Translation{T: "DEX reported unknown orders"},
		template: intl.Translation{T: "%d active orders reported by DEX %s were not found.", Notes: "args: [count, host]"},
	},
	TopicOrdersReconciled: {
		subject:  intl.Translation{T: "Orders reconciled with DEX"},
		template: intl.Translation{T: "Statuses updated for %d orders.", Notes: "args: [count]"},
	},
	TopicWalletConfigurationUpdated: {
		subject:  intl.Translation{T: "Wallet configuration updated"},
		template: intl.Translation{T: "Configuration for %s wallet has been updated. Deposit address = %s", Notes: "args: [ticker, address]"},
	},
	TopicWalletPasswordUpdated: {
		subject:  intl.Translation{T: "Wallet Password Updated"},
		template: intl.Translation{T: "Password for %s wallet has been updated.", Notes: "args:  [ticker]"},
	},
	TopicMarketSuspendScheduled: {
		subject:  intl.Translation{T: "Market suspend scheduled"},
		template: intl.Translation{T: "Market %s at %s is now scheduled for suspension at %v", Notes: "args: [market name, host, time]"},
	},
	TopicMarketSuspended: {
		subject:  intl.Translation{T: "Market suspended"},
		template: intl.Translation{T: "Trading for market %s at %s is now suspended.", Notes: "args: [market name, host]"},
	},
	TopicMarketSuspendedWithPurge: {
		subject:  intl.Translation{T: "Market suspended, orders purged"},
		template: intl.Translation{T: "Trading for market %s at %s is now suspended. All booked orders are now PURGED.", Notes: "args: [market name, host]"},
	},
	TopicMarketResumeScheduled: {
		subject:  intl.Translation{T: "Market resume scheduled"},
		template: intl.Translation{T: "Market %s at %s is now scheduled for resumption at %v", Notes: "args: [market name, host, time]"},
	},
	TopicMarketResumed: {
		subject:  intl.Translation{T: "Market resumed"},
		template: intl.Translation{T: "Market %s at %s has resumed trading at epoch %d", Notes: "args: [market name, host, epoch]"},
	},
	TopicUpgradeNeeded: {
		subject:  intl.Translation{T: "Upgrade needed"},
		template: intl.Translation{T: "You may need to update your client to trade at %s.", Notes: "args: [host]"},
	},
	TopicDEXConnected: {
		subject:  intl.Translation{T: "Server connected"},
		template: intl.Translation{T: "%s is connected", Notes: "args: [host]"},
	},
	TopicDEXDisconnected: {
		subject:  intl.Translation{T: "Server disconnect"},
		template: intl.Translation{T: "%s is disconnected", Notes: "args: [host]"},
	},
	TopicDexConnectivity: {
		subject:  intl.Translation{T: "Internet Connectivity"},
		template: intl.Translation{T: "Your internet connection to %s is unstable, check your internet connection", Notes: "args: [host]"},
	},
	TopicPenalized: {
		subject:  intl.Translation{T: "Server has penalized you"},
		template: intl.Translation{T: "Penalty from DEX at %s\nlast broken rule: %s\ntime: %v\ndetails:\n\"%s\"\n", Notes: "args: [host, rule, time, details]"},
	},
	TopicSeedNeedsSaving: {
		subject:  intl.Translation{T: "Don't forget to back up your application seed"},
		template: intl.Translation{T: "A new application seed has been created. Make a back up now in the settings view."},
	},
	TopicUpgradedToSeed: {
		subject:  intl.Translation{T: "Back up your new application seed"},
		template: intl.Translation{T: "The client has been upgraded to use an application seed. Back up the seed now in the settings view."},
	},
	TopicDEXNotification: {
		subject:  intl.Translation{T: "Message from DEX"},
		template: intl.Translation{T: "%s: %s", Notes: "args: [host, msg]"},
	},
	TopicQueuedCreationFailed: {
		subject:  intl.Translation{T: "Failed to create token wallet"},
		template: intl.Translation{T: "After creating %s wallet, failed to create the %s wallet", Notes: "args: [parentSymbol, tokenSymbol]"},
	},
	TopicRedemptionResubmitted: {
		subject:  intl.Translation{T: "Redemption Resubmitted"},
		template: intl.Translation{T: "Your redemption for match %s in order %s was resubmitted."},
	},
	TopicSwapRefunded: {
		subject:  intl.Translation{T: "Swap Refunded"},
		template: intl.Translation{T: "Match %s in order %s was refunded by the counterparty."},
	},
	TopicRedemptionConfirmed: {
		subject:  intl.Translation{T: "Redemption Confirmed"},
		template: intl.Translation{T: "Your redemption for match %s in order %s was confirmed"},
	},
	TopicWalletTypeDeprecated: {
		subject:  intl.Translation{T: "Wallet Disabled"},
		template: intl.Translation{T: "Your %s wallet type is no longer supported. Create a new wallet."},
	},
	TopicOrderResumeFailure: {
		subject:  intl.Translation{T: "Resume order failure"},
		template: intl.Translation{T: "Failed to resume processing of trade: %v"},
	},
	TopicBondConfirming: {
		subject:  intl.Translation{T: "Confirming bond"},
		template: intl.Translation{T: "Waiting for %d confirmations to post bond %v (%s) to %s", Notes: "args: [reqConfs, bondCoinStr, assetID, acct.host]"},
	},
	TopicBondConfirmed: {
		subject:  intl.Translation{T: "Bond confirmed"},
		template: intl.Translation{T: "New tier = %d (target = %d).", Notes: "args: [effectiveTier, targetTier]"},
	},
	TopicBondExpired: {
		subject:  intl.Translation{T: "Bond expired"},
		template: intl.Translation{T: "New tier = %d (target = %d).", Notes: "args: [effectiveTier, targetTier]"},
	},
	TopicBondRefunded: {
		subject:  intl.Translation{T: "Bond refunded"},
		template: intl.Translation{T: "Bond %v for %v refunded in %v, reclaiming %v of %v after tx fees", Notes: "args: [bondIDStr, acct.host, refundCoinStr, refundVal, Amount]"},
	},
	TopicBondPostError: {
		subject:  intl.Translation{T: "Bond post error"},
		template: intl.Translation{T: "postbond request error (will retry): %v (%T)", Notes: "args: [err, err]"},
	},
	TopicBondPostErrorConfirm: {
		subject:  intl.Translation{T: "Bond post error"},
		template: intl.Translation{T: "Error encountered while waiting for bond confirms for %s: %v"},
	},
	TopicDexAuthErrorBond: {
		subject:  intl.Translation{T: "Authentication error"},
		template: intl.Translation{T: "Bond confirmed, but failed to authenticate connection: %v", Notes: "args: [err]"},
	},
	TopicAccountRegTier: {
		subject:  intl.Translation{T: "Account registered"},
		template: intl.Translation{T: "New tier = %d", Notes: "args: [effectiveTier]"},
	},
	TopicUnknownBondTierZero: {
		subject: intl.Translation{T: "Unknown bond found"},
		template: intl.Translation{
			T: "Unknown %s bonds were found and added to active bonds " +
				"but your target tier is zero for the dex at %s. Set your " +
				"target tier in Settings to stay bonded with auto renewals.",
			Notes: "args: [bond asset, dex host]",
		},
	},
}

var ptBR = map[Topic]*translation{
	TopicAccountRegistered: {
		subject:  intl.Translation{T: "Conta Registrada"},
		template: intl.Translation{T: "Você agora pode trocar em %s"},
	},
	TopicFeePaymentInProgress: {
		subject:  intl.Translation{T: "Pagamento da Taxa em andamento"},
		template: intl.Translation{T: "Esperando por %d confirmações antes de trocar em %s"},
	},
	TopicRegUpdate: {
		subject:  intl.Translation{T: "Atualização de registro"},
		template: intl.Translation{T: "Confirmações da taxa %v/%v"},
	},
	TopicFeePaymentError: {
		subject:  intl.Translation{T: "Erro no Pagamento da Taxa"},
		template: intl.Translation{T: "Erro enquanto pagando taxa para %s: %v"},
	},
	TopicAccountUnlockError: {
		subject:  intl.Translation{T: "Erro ao Destrancar carteira"},
		template: intl.Translation{T: "erro destrancando conta %s: %v"},
	},
	TopicFeeCoinError: {
		subject:  intl.Translation{T: "Erro na Taxa"},
		template: intl.Translation{T: "Taxa vazia para %s."},
	},
	TopicWalletConnectionWarning: {
		subject:  intl.Translation{T: "Aviso de Conexão com a Carteira"},
		template: intl.Translation{T: "Registro incompleto detectado para %s, mas falhou ao conectar com carteira decred"},
	},
	TopicWalletUnlockError: {
		subject:  intl.Translation{T: "Erro ao Destravar Carteira"},
		template: intl.Translation{T: "Conectado com carteira para completar o registro em %s, mas falha ao destrancar: %v"},
	},
	TopicSendError: {
		subject:  intl.Translation{T: "Erro Retirada"},
		template: intl.Translation{T: "Erro encontrado durante retirada de %s: %v"},
	},
	TopicSendSuccess: {
		template: intl.Translation{T: "Retirada de %s %s (%s) foi completada com sucesso. ID da moeda = %s"},
		subject:  intl.Translation{T: "Retirada Enviada"},
	},
	TopicOrderLoadFailure: {
		template: intl.Translation{T: "Alguns pedidos falharam ao carregar da base de dados: %v"},
		subject:  intl.Translation{T: "Carregamendo de Pedidos Falhou"},
	},
	TopicYoloPlaced: {
		template: intl.Translation{T: "vendendo %s %s a taxa de mercado (%s)"},
		subject:  intl.Translation{T: "Ordem de Mercado Colocada"},
	},
	TopicBuyOrderPlaced: {
		subject:  intl.Translation{T: "Ordem Colocada"},
		template: intl.Translation{T: "Buying %s %s, valor = %s (%s)"},
	},
	TopicSellOrderPlaced: {
		subject:  intl.Translation{T: "Ordem Colocada"},
		template: intl.Translation{T: "Selling %s %s, valor = %s (%s)"},
	},
	TopicMissingMatches: {
		template: intl.Translation{T: "%d combinações para pedidos %s não foram reportados por %q e foram considerados revocados"},
		subject:  intl.Translation{T: "Pedidos Faltando Combinações"},
	},
	TopicWalletMissing: {
		template: intl.Translation{T: "Erro ao recuperar pedidos ativos por carteira %s: %v"},
		subject:  intl.Translation{T: "Carteira Faltando"},
	},
	TopicMatchErrorCoin: {
		subject:  intl.Translation{T: "Erro combinação de Moedas"},
		template: intl.Translation{T: "Combinação %s para pedido %s está no estado %s, mas não há um executador para trocar moedas."},
	},
	TopicMatchErrorContract: {
		template: intl.Translation{T: "Combinação %s para pedido %s está no estado %s, mas não há um executador para trocar moedas."},
		subject:  intl.Translation{T: "Erro na Combinação de Contrato"},
	},
	TopicMatchRecoveryError: {
		template: intl.Translation{T: "Erro auditando contrato de troca da contraparte (%s %v) durante troca recuperado no pedido %s: %v"},
		subject:  intl.Translation{T: "Erro Recuperando Combinações"},
	},
	TopicOrderCoinError: {
		template: intl.Translation{T: "Não há Moedas de financiamento registradas para pedidos ativos %s"},
		subject:  intl.Translation{T: "Erro no Pedido da Moeda"},
	},
	TopicOrderCoinFetchError: {
		template: intl.Translation{T: "Erro ao recuperar moedas de origem para pedido %s (%s): %v"},
		subject:  intl.Translation{T: "Erro na Recuperação do Pedido de Moedas"},
	},
	TopicMissedCancel: {
		template: intl.Translation{T: "Pedido de cancelamento não combinou para pedido %s. Isto pode acontecer se o pedido de cancelamento foi enviado no mesmo epoque do que a troca ou se o pedido foi completamente executado antes da ordem de cancelamento ser executada."},
		subject:  intl.Translation{T: "Cancelamento Perdido"},
	},
	TopicSellOrderCanceled: {
		template: intl.Translation{T: "Sell pedido sobre %s-%s em %s foi cancelado (%s)"},
		subject:  intl.Translation{T: "Cancelamento de Pedido"},
	},
	TopicBuyOrderCanceled: {
		template: intl.Translation{T: "Buy pedido sobre %s-%s em %s foi cancelado (%s)"},
		subject:  intl.Translation{T: "Cancelamento de Pedido"},
	},
	TopicSellMatchesMade: {
		template: intl.Translation{T: "Sell pedido sobre %s-%s %.1f%% preenchido (%s)"},
		subject:  intl.Translation{T: "Combinações Feitas"},
	},
	TopicBuyMatchesMade: {
		template: intl.Translation{T: "Buy pedido sobre %s-%s %.1f%% preenchido (%s)"},
		subject:  intl.Translation{T: "Combinações Feitas"},
	},
	TopicSwapSendError: {
		template: intl.Translation{T: "Erro encontrado ao enviar a troca com output(s) no valor de %s %s no pedido %s"},
		subject:  intl.Translation{T: "Erro ao Enviar Troca"},
	},
	TopicInitError: {
		template: intl.Translation{T: "Erro notificando DEX da troca %s por combinação: %v"},
		subject:  intl.Translation{T: "Erro na Troca"},
	},
	TopicReportRedeemError: {
		template: intl.Translation{T: "Erro notificando DEX da redenção %s por combinação: %v"},
		subject:  intl.Translation{T: "Reportando Erro na redenção"},
	},
	TopicSwapsInitiated: {
		template: intl.Translation{T: "Enviar trocas no valor de %s %s no pedido %s"},
		subject:  intl.Translation{T: "Trocas Iniciadas"},
	},
	TopicRedemptionError: {
		template: intl.Translation{T: "Erro encontrado enviado redenção no valor de %s %s no pedido %s"},
		subject:  intl.Translation{T: "Erro na Redenção"},
	},
	TopicMatchComplete: {
		template: intl.Translation{T: "Resgatado %s %s no pedido %s"},
		subject:  intl.Translation{T: "Combinação Completa"},
	},
	TopicRefundFailure: {
		template: intl.Translation{T: "Devolvidos %s %s no pedido %s, com algum erro"},
		subject:  intl.Translation{T: "Erro no Reembolso"},
	},
	TopicMatchesRefunded: {
		template: intl.Translation{T: "Devolvidos %s %s no pedido %s"},
		subject:  intl.Translation{T: "Reembolso Sucedido"},
	},
	TopicMatchRevoked: {
		template: intl.Translation{T: "Combinação %s foi revocada"},
		subject:  intl.Translation{T: "Combinação Revocada"},
	},
	TopicOrderRevoked: {
		template: intl.Translation{T: "Pedido %s no mercado %s em %s foi revocado pelo servidor"},
		subject:  intl.Translation{T: "Pedido Revocado"},
	},
	TopicOrderAutoRevoked: {
		template: intl.Translation{T: "Pedido %s no mercado %s em %s revocado por suspenção do mercado"},
		subject:  intl.Translation{T: "Pedido Revocado Automatiamente"},
	},
	TopicMatchRecovered: {
		template: intl.Translation{T: "Encontrado redenção do executador (%s: %v) e validado segredo para pedido %s"},
		subject:  intl.Translation{T: "Pedido Recuperado"},
	},
	TopicCancellingOrder: {
		template: intl.Translation{T: "Uma ordem de cancelamento foi submetida para o pedido %s"},
		subject:  intl.Translation{T: "Cancelando Pedido"},
	},
	TopicOrderStatusUpdate: {
		template: intl.Translation{T: "Status do pedido %v revisado de %v para %v"},
		subject:  intl.Translation{T: "Status do Pedido Atualizado"},
	},
	TopicMatchResolutionError: {
		template: intl.Translation{T: "%d combinações reportada para %s não foram encontradas para %s."},
		subject:  intl.Translation{T: "Erro na Resolução do Pedido"},
	},
	TopicFailedCancel: {
		template: intl.Translation{T: "Ordem de cancelamento para pedido %s presa em estado de Epoque por 2 epoques e foi agora deletado."},
		subject:  intl.Translation{T: "Falhou Cancelamento"},
	},
	TopicAuditTrouble: {
		template: intl.Translation{T: "Continua procurando por contrato de contrapartes para moeda %v (%s) para combinação %s. Sua internet e conexão com a carteira estão ok?"},
		subject:  intl.Translation{T: "Problemas ao Auditar"},
	},
	TopicDexAuthError: {
		template: intl.Translation{T: "%s: %v"},
		subject:  intl.Translation{T: "Erro na Autenticação"},
	},
	TopicUnknownOrders: {
		template: intl.Translation{T: "%d pedidos ativos reportados pela DEX %s não foram encontrados."},
		subject:  intl.Translation{T: "DEX Reportou Pedidos Desconhecidos"},
	},
	TopicOrdersReconciled: {
		template: intl.Translation{T: "Estados atualizados para %d pedidos."},
		subject:  intl.Translation{T: "Pedidos Reconciliados com DEX"},
	},
	TopicWalletConfigurationUpdated: {
		template: intl.Translation{T: "configuração para carteira %s foi atualizada. Endereço de depósito = %s"},
		subject:  intl.Translation{T: "Configurações da Carteira Atualizada"},
	},
	TopicWalletPasswordUpdated: {
		template: intl.Translation{T: "Senha para carteira %s foi atualizada."},
		subject:  intl.Translation{T: "Senha da Carteira Atualizada"},
	},
	TopicMarketSuspendScheduled: {
		template: intl.Translation{T: "Mercado %s em %s está agora agendado para suspensão em %v"},
		subject:  intl.Translation{T: "Suspensão de Mercado Agendada"},
	},
	TopicMarketSuspended: {
		template: intl.Translation{T: "Trocas no mercado %s em %s está agora suspenso."},
		subject:  intl.Translation{T: "Mercado Suspenso"},
	},
	TopicMarketSuspendedWithPurge: {
		template: intl.Translation{T: "Trocas no mercado %s em %s está agora suspenso. Todos pedidos no livro de ofertas foram agora EXPURGADOS."},
		subject:  intl.Translation{T: "Mercado Suspenso, Pedidos Expurgados"},
	},
	TopicMarketResumeScheduled: {
		template: intl.Translation{T: "Mercado %s em %s está agora agendado para resumir em %v"},
		subject:  intl.Translation{T: "Resumo do Mercado Agendado"},
	},
	TopicMarketResumed: {
		template: intl.Translation{T: "Mercado %s em %s foi resumido para trocas no epoque %d"},
		subject:  intl.Translation{T: "Mercado Resumido"},
	},
	TopicUpgradeNeeded: {
		template: intl.Translation{T: "Você pode precisar atualizar seu cliente para trocas em %s."},
		subject:  intl.Translation{T: "Atualização Necessária"},
	},
	TopicDEXConnected: {
		subject:  intl.Translation{T: "DEX conectado"},
		template: intl.Translation{T: "%s está conectado"},
	},
	TopicDEXDisconnected: {
		template: intl.Translation{T: "%s está desconectado"},
		subject:  intl.Translation{T: "Server Disconectado"},
	},
	TopicPenalized: {
		template: intl.Translation{T: "Penalidade de DEX em %s\núltima regra quebrada: %s\nhorário: %v\ndetalhes:\n\"%s\"\n"},
		subject:  intl.Translation{T: "Server Penalizou Você"},
	},
	TopicSeedNeedsSaving: {
		subject:  intl.Translation{T: "Não se esqueça de guardar a seed do app"},
		template: intl.Translation{T: "Uma nova seed para a aplicação foi criada. Faça um backup agora na página de configurações."},
	},
	TopicUpgradedToSeed: {
		subject:  intl.Translation{T: "Guardar nova seed do app"},
		template: intl.Translation{T: "O cliente foi atualizado para usar uma seed. Faça backup dessa seed na página de configurações."},
	},
	TopicDEXNotification: {
		subject:  intl.Translation{T: "Mensagem da DEX"},
		template: intl.Translation{T: "%s: %s"},
	},
}

// The language string key *must* parse with language.Parse.
var locales = map[string]map[Topic]*translation{
	originLang: originLocale,
}

func init() {
	for lang, translations := range locales {
		langtag, err := language.Parse(lang)
		if err != nil {
			panic(err.Error())
		} // otherwise would fail in core.New parsing the languages
		for topic, translation := range translations {
			err := message.SetString(langtag, string(topic), translation.template.T)
			if err != nil {
				panic(fmt.Sprintf("SetString(%s): %v", lang, err))
			}
		}
	}
}

// RegisterTranslations registers translations with the init package for
// translator worksheet preparation.
func RegisterTranslations() {
	const callerID = "notifications"

	for lang, m := range locales {
		r := intl.NewRegistrar(callerID, lang, len(m)*2)
		for topic, t := range m {
			r.Register(string(topic)+" subject", &t.subject)
			r.Register(string(topic)+" template", &t.template)
		}
	}
}

// CheckTopicLangs is used to report missing notification translations.
func CheckTopicLangs() (missingTranslations int) {
	for topic := range originLocale {
		for _, m := range locales {
			if _, found := m[topic]; !found {
				missingTranslations += len(m)
			}
		}
	}
	return
}
