import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CommitmentDetail as CommitmentDetailType } from '../api';
import { ReassignBuyerSection } from './ReassignBuyerSection';

const baseCommitment: CommitmentDetailType = {
  status: 'Draft',
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
  title: 'Components/ReassignBuyerSection',
  component: ReassignBuyerSection,
  tags: ['autodocs'],
  args: {
    commitment: baseCommitment,
    contractId,
    walletAddress: buyer,
    onReassigned: fn(),
  },
} satisfies Meta<typeof ReassignBuyerSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentBuyerCanPropose: Story = {};

export const NotTheCurrentBuyer: Story = {
  args: {
    walletAddress: cooperative,
  },
};

export const StrangerSeesNothing: Story = {
  args: {
    walletAddress: stranger,
  },
};

export const NoWalletConnected: Story = {
  args: {
    walletAddress: null,
  },
};

export const PastReassignableRange: Story = {
  args: {
    commitment: { ...baseCommitment, status: 'Delivered' },
  },
};
