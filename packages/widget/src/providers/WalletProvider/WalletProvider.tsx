import type { Signer } from '@ethersproject/abstract-signer';
import { StaticToken, getChainById } from '@lifi/sdk';
import {
  LiFiWalletManagement,
  readActiveWallets,
  supportedWallets,
  switchChain as walletAgnosticSwitchChain,
  switchChainAndAddToken as walletAgnosticAddToken,
  addChain as walletAgnosticAddChain,
} from '@lifi/wallet-management';
import type { Wallet } from '@lifi/wallet-management/types';
import type { FC, PropsWithChildren } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useWidgetConfig } from '../WidgetProvider';
import type { WalletAccount, WalletContextProps } from './types';
import { Web3Provider } from '@ethersproject/providers';

const liFiWalletManagement = new LiFiWalletManagement();

const stub = (): never => {
  throw new Error(
    `You forgot to wrap your component in <${WalletProvider.name}>.`,
  );
};

const initialContext: WalletContextProps = {
  connect: stub,
  disconnect: stub,
  switchChain: stub,
  addChain: stub,
  addToken: stub,
  account: {},
};

const WalletContext = createContext<WalletContextProps>(initialContext);

export const useWallet = (): WalletContextProps => useContext(WalletContext);

export const WalletProvider: FC<PropsWithChildren> = ({ children }) => {
  const { walletManagement } = useWidgetConfig();
  const [account, setAccount] = useState<WalletAccount>({});
  const [currentWallet, setCurrentWallet] = useState<Wallet | undefined>();

  useEffect(() => {
    const autoConnect = async () => {
      const persistedActiveWallets = readActiveWallets();
      const activeWallets = supportedWallets.filter((wallet) =>
        persistedActiveWallets.some(
          (perstistedWallet) => perstistedWallet.name === wallet.name,
        ),
      );
      if (!activeWallets.length) {
        return;
      }
      await liFiWalletManagement.autoConnect(activeWallets);
      activeWallets[0].on('walletAccountChanged', handleWalletUpdate);
      handleWalletUpdate(activeWallets[0]);
    };
    autoConnect();
  }, []);

  const handleWalletUpdate = async (wallet?: Wallet) => {
    setCurrentWallet(wallet);
    const account = await extractAccountFromSigner(wallet?.account?.signer);
    setAccount(account);
  };

  const connect = useCallback(
    async (wallet: Wallet) => {
      if (walletManagement) {
        const signer = await walletManagement.connect();
        const account = await extractAccountFromSigner(signer);
        setAccount(account);
        return;
      }
      await liFiWalletManagement.connect(wallet);
      wallet.on('walletAccountChanged', handleWalletUpdate);
      handleWalletUpdate(wallet);
    },
    [walletManagement],
  );

  const disconnect = useCallback(async () => {
    if (walletManagement) {
      await walletManagement.disconnect();
      setAccount({});
      return;
    }
    if (currentWallet) {
      await liFiWalletManagement.disconnect(currentWallet);
      currentWallet.removeAllListeners();
      handleWalletUpdate(undefined);
    }
  }, [walletManagement, currentWallet]);

  const switchChain = useCallback(
    async (chainId: number) => {
      try {
        if (walletManagement?.switchChain) {
          const signer = await walletManagement.switchChain(chainId);
          const account = await extractAccountFromSigner(signer);
          setAccount(account);
        } else if (!currentWallet) {
          const provider = account.signer?.provider as Web3Provider;
          if (!provider) {
            throw new Error('switch chain: No provider available');
          }
          await walletAgnosticSwitchChain(provider, chainId);
        } else {
          await currentWallet?.switchChain(chainId);
          handleWalletUpdate(currentWallet);
        }
        return true;
      } catch {
        return false;
      }
    },
    [walletManagement, currentWallet, account?.signer?.provider],
  );

  const addChain = useCallback(
    async (chainId: number) => {
      try {
        if (walletManagement?.addChain) {
          return walletManagement.addChain(chainId);
        } else if (!currentWallet) {
          const provider = account.signer?.provider as Web3Provider;
          if (!provider) {
            throw new Error('switch chain: No provider available');
          }
          await walletAgnosticAddChain(provider, chainId);
        } else {
          await currentWallet?.addChain(chainId);
          handleWalletUpdate(currentWallet);
        }

        return true;
      } catch {
        return false;
      }
    },
    [walletManagement, currentWallet, account?.signer?.provider],
  );

  const addToken = useCallback(
    async (chainId: number, token: StaticToken) => {
      try {
        if (walletManagement?.addToken) {
          return walletManagement.addToken(token, chainId);
        } else if (!currentWallet) {
          const provider = account.signer?.provider as Web3Provider;
          if (!provider) {
            throw new Error('switch chain: No provider available');
          }
          await walletAgnosticAddToken(provider, chainId, token);
        } else {
          await currentWallet?.addToken(chainId, token);
          handleWalletUpdate(currentWallet);
        }
      } catch {}
    },
    [walletManagement, currentWallet, account?.signer?.provider],
  );

  // keep widget in sync with changing external signer object
  useEffect(() => {
    if (walletManagement) {
      const updateAccount = async () => {
        const account = await extractAccountFromSigner(
          walletManagement?.signer,
        );
        setAccount(account);
      };
      updateAccount();
    }
  }, [walletManagement, walletManagement?.signer]);

  const value = useMemo(
    () => ({
      connect,
      disconnect,
      switchChain,
      addChain,
      addToken,
      account,
      provider: currentWallet?.account?.provider,
    }),
    [
      account,
      addChain,
      addToken,
      connect,
      disconnect,
      currentWallet,
      switchChain,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};

export const extractAccountFromSigner = async (signer?: Signer) => {
  try {
    return {
      address: await signer?.getAddress(),
      isActive: (signer && !!(await signer.getAddress()) === null) || !!signer,
      signer,
      chainId: await signer?.getChainId(),
    };
  } catch (error) {
    console.error(error);
    return {};
  }
};
