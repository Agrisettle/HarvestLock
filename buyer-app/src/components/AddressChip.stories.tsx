import type { Meta, StoryObj } from '@storybook/react-vite';
import { AddressChip } from './AddressChip';

const meta = {
  title: 'Components/AddressChip',
  component: AddressChip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    address: { control: 'text' },
    copyable: { control: 'boolean' },
    className: { control: 'text' },
  },
  args: {
    address: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    copyable: true,
    className: undefined,
  },
} satisfies Meta<typeof AddressChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    address: 'GBUYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  },
};

export const ContractId: Story = {
  args: {
    address: 'CXXXUSDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    className: 'contract-id',
  },
};

export const NotCopyable: Story = {
  args: {
    address: 'GCOOPXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    copyable: false,
  },
};

export const WithCustomClass: Story = {
  args: {
    address: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    className: 'address-chip',
  },
};
