import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CommitmentDetail as CommitmentDetailType } from '../api';
import { CancelSection } from './CancelSection';

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
const cooperative = 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const stranger = 'GSTRANGERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const meta = {
  title: 'Components/CancelSection',
  component: CancelSection,
  tags: ['autodocs'],
  args: {
    commitment: baseCommitment,
    contractId,
    walletAddress: buyer,
    onCancelled: fn(),
  },
} satisfies Meta<typeof CancelSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoWalletConnected: Story = {
  args: {
    walletAddress: null,
  },
};

export const NotAParty: Story = {
  args: {
    walletAddress: stranger,
  },
};

export const PastCancellableRange: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Delivered' },
  },
};

export const BuyerCanPropose: Story = {};

export const CooperativeCanPropose: Story = {
  args: {
    walletAddress: cooperative,
  },
};

export const DraftStatus: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Draft' },
  },
};
