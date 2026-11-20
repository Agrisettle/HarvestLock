import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { CreateCommitmentForm } from './CreateCommitmentForm';

const meta = {
  title: 'Components/CreateCommitmentForm',
  component: CreateCommitmentForm,
  tags: ['autodocs'],
  argTypes: {
    submitting: { control: 'boolean' },
    submitError: { control: 'text' },
  },
  args: {
    onSubmit: fn(),
    submitting: false,
    submitError: null,
  },
} satisfies Meta<typeof CreateCommitmentForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const PreFilled: Story = {
  args: {
    onSubmit: fn(),
  },
};

export const Submitting: Story = {
  args: {
    submitting: true,
  },
};

export const SubmitError: Story = {
  args: {
    submitError: "Could not create commitment — the API didn't respond. Try again.",
  },
};
