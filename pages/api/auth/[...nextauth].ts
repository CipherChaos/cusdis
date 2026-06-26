import NextAuth from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma, resolvedConfig } from "../../../utils.server";
import { authProviders } from "../../../config.server";
import { statService } from "../../../service/stat.service";

declare module "next-auth" {
  interface Session {
    uid: string
  }
  interface User {
    id: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
  }
}

export default NextAuth({
  providers: authProviders,
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  secret: resolvedConfig.jwtSecret,
  callbacks: {
    async session({ session, token }) {
      session.uid = token.id as string
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async signIn() {
      statService.capture('signIn')
      return true
    }
  },
  events: {
    async error(message) {
      console.log(message)
    },
  },
})
