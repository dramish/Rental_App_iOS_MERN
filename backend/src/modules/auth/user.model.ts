import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['customer', 'shop', 'driver', 'admin'], default: 'customer' },
    appleSub: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
