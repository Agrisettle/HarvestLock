import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CommitmentDetail as CommitmentDetailType } from '../api';
import { CommitmentDetail } from './CommitmentDetail';

const baseCommitment: CommitmentDetailType = {
  status: 'Locked',
  buyer: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  cooperative: 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  warehouse_operator: 'GWHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  token: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  total_amount: '1000000000',
  advance1_bps: 1500,
  advance2_bps: 2000,
  claim_window_secs: '3600',
  remainder_window_secs: '604800',
  created_at: '1788245397',
  delivery_deadline: '1798245397',
  advance1_deadline: '0',
  advance1_claimed: false,
  advance1_expired: false,
  advance2_deadline: '0',
  advance2_claimed: false,
  advance2_expired: false,
  remainder_deadline: '0',
  remainder_funded: false,
  contracted_quantity: 1000,
  grade_price_bps: [10_000],
  delivered_quantity: 0,
  grade_index: 0,
  settlement_bps: 0,
  fx_resolved: false,
  fx_adjusted_total: '0',
  fx_shortfall_amount: '0',
  fx_shortfall_funded: false,
  fx_shortfall_deadline: '0',
  dispute_pre_status: 'Draft',
  dispute_deadline: '0',
};

const contractId = 'CXXXUSDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const buyer = 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const cooperativeWallet = 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const meta = {
  title: 'Components/CommitmentDetail',
  component: CommitmentDetail,
  tags: ['autodocs'],
  argTypes: {
    actionInFlight: { control: 'boolean' },
    actionError: { control: 'text' },
    walletAddress: { control: 'text' },
  },
  args: {
    commitment: baseCommitment,
    contractId,
    walletAddress: buyer,
    onAction: fn(),
    actionInFlight: false,
    actionError: null,
    onCancelled: fn(),
    onReassigned: fn(),
    onDisputeChanged: fn(),
  },
} satisfies Meta<typeof CommitmentDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DraftBuyerConnected: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Draft' },
    walletAddress: buyer,
  },
};

export const DraftNoWallet: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Draft' },
    walletAddress: null,
  },
};

export const LockedBuyerConnected: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Locked' },
    walletAddress: buyer,
  },
};

export const DeliveredAnyConnectedWallet: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Delivered' },
    walletAddress: cooperativeWallet,
  },
};

export const DeliveredNoWallet: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Delivered' },
    walletAddress: null,
  },
};

export const Disputed: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Disputed' },
    walletAddress: buyer,
  },
};

export const Cancelled: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Cancelled' },
    walletAddress: buyer,
  },
};

export const Settled: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Settled' },
    walletAddress: buyer,
  },
};

export const ActionInFlight: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Draft' },
    walletAddress: buyer,
    actionInFlight: true,
  },
};

export const ActionError: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Delivered' },
    walletAddress: buyer,
    actionInFlight: false,
    actionError: 'Transaction failed — the wallet rejected the signature. Please retry.',
  },
};
