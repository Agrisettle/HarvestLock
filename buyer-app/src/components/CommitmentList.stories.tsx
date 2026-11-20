import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { CommitmentSummary } from '../api';
import { CommitmentList } from './CommitmentList';

const commitments: CommitmentSummary[] = [
  {
    id: 'commit-1',
    contract_id: 'CXXXUSDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    buyer_address: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    cooperative_address: 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    warehouse_address: 'GWHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    token_address: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    total_amount: '1000000000',
    advance1_bps: 1500,
    advance2_bps: 2000,
    claim_window_secs: '3600',
    status: 'Locked',
    created_at: '1788245397',
    updated_at: '1788245397',
  },
  {
    id: 'commit-2',
    contract_id: 'CYYYEURXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    buyer_address: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    cooperative_address: 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    warehouse_address: 'GWHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    token_address: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    total_amount: '2500000000',
    advance1_bps: 3000,
    advance2_bps: 0,
    claim_window_secs: '86400',
    status: 'Delivered',
    created_at: '1788100000',
    updated_at: '1798100000',
  },
];

const meta = {
  title: 'Components/CommitmentList',
  component: CommitmentList,
  tags: ['autodocs'],
  argTypes: {
    commitments: { control: 'object' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    onSelect: { action: 'onSelect' },
  },
  args: {
    commitments: [],
    loading: false,
    error: null,
    onSelect: fn(),
  },
} satisfies Meta<typeof CommitmentList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const Error: Story = {
  args: {
    error: '/commitments -> 500: {"statusCode":500,"error":"Internal Server Error","message":"connection refused"}',
  },
};

export const Empty: Story = {
  args: {
    commitments: [],
  },
};

export const WithCommitments: Story = {
  args: {
    commitments,
  },
};

export const MixedStatuses: Story = {
  args: {
    commitments: [
      ...commitments,
      {
        id: 'commit-3',
        contract_id: 'CZZZGBPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        buyer_address: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        cooperative_address: 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        warehouse_address: 'GWHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        token_address: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        total_amount: '750000000',
        advance1_bps: 2500,
        advance2_bps: 2500,
        claim_window_secs: '3600',
        status: 'Disputed',
        created_at: '1788200000',
        updated_at: '1788250000',
      },
    ],
  },
};
