<template>
  <div class="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
    <div class="overflow-hidden bg-white shadow dark:bg-gray-800 sm:rounded-lg">
      <div class="px-4 py-6 sm:px-6">
        <h3 class="text-base font-semibold leading-7 text-black dark:text-white">Account Information</h3>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-black dark:text-gray-200">Personal details and information.</p>
      </div>
      <div class="border-t border-gray-400">
        <dl class="divide-y divide-gray-400">
          <div class="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
            <dt class="text-sm font-medium text-black dark:text-white">Username</dt>
            <dd class="mt-1 text-sm leading-6 text-black dark:text-gray-200 sm:col-span-2 sm:mt-0">
              {{ currentUser.email }}
            </dd>
          </div>
          <div class="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
            <dt class="text-sm font-medium text-black dark:text-white">Role</dt>
            <dd class="mt-1 text-sm leading-6 text-black dark:text-gray-200 sm:col-span-2 sm:mt-0">
              {{ currentUser.UserRole.name }}
            </dd>
          </div>
          <div v-if="passwordEdit != true" class="grid grid-cols-3 gap-4 px-4 py-6 sm:px-6">
            <dt class="text-sm font-medium text-black dark:text-white">Password</dt>
            <dd class="mt-1 flex text-sm leading-6 text-black dark:text-gray-200 sm:col-span-2 sm:mt-0">
              <span class="flex-grow">**********</span>
              <span class="mx-4 flex-shrink-0">
                <button
                  type="button"
                  class="text-md font-semibold text-indigo-600 hover:text-indigo-500"
                  @click="passwordEdit = true"
                >
                  Change
                </button>
              </span>
            </dd>
          </div>

          <!-- Change Password -->
          <div v-else class="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-6 py-6 md:grid-cols-3">
            <div>
              <h2 class="text-sm font-semibold text-black dark:text-white">Change password</h2>
              <p class="mt-1 text-sm leading-6 text-gray-400">Update your password associated with your account.</p>
            </div>

            <form class="md:col-span-2" @submit.prevent="">
              <div class="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
                <!-- <div class="col-span-full">
                  <label for="current-password" class="block text-sm font-medium leading-6 text-white">Current password</label>
                  <div class="mt-2">
                    <input id="current-password" name="current_password" type="password" autocomplete="current-password" class="block w-full rounded-md border-0 bg-white/5 py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6" />
                  </div>
                </div> -->

                <div class="col-span-full">
                  <label for="new-password" class="block text-sm font-medium leading-6 text-black dark:text-white"
                    >New password</label
                  >

                  <div class="mt-2">
                    <input
                      v-model="newPassword"
                      required
                      id="new-password"
                      name="new_password"
                      type="password"
                      autocomplete="new-password"
                      class="block w-full rounded-md border-0 bg-black/5 py-1.5 text-black shadow-sm ring-1 ring-inset ring-black/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-white/5 dark:text-white dark:ring-white/10 sm:text-sm sm:leading-6"
                    />
                  </div>
                </div>

                <div class="col-span-full">
                  <label for="confirm-password" class="block text-sm font-medium leading-6 text-black dark:text-white"
                    >Confirm password</label
                  >

                  <div class="mt-2">
                    <input
                      v-model="confirmNewPassword"
                      required
                      id="confirm-password"
                      name="confirm_password"
                      type="password"
                      autocomplete="new-password"
                      class="block w-full rounded-md border-0 bg-black/5 py-1.5 text-black shadow-sm ring-1 ring-inset ring-black/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-white/5 dark:text-white dark:ring-white/10 sm:text-sm sm:leading-6"
                    />
                  </div>
                </div>
              </div>

              <div class="mt-8 flex">
                <button
                  @click="passwordEdit = false"
                  class="mr-4 rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                >
                  Cancel
                </button>
                <button
                  @click="checkPasswords()"
                  class="rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                >
                  Save
                </button>
                <transition
                  enter-active-class="transform ease-out duration-300 transition"
                  enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
                  enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
                  leave-active-class="transition ease-in duration-300"
                  leave-from-class="opacity-100"
                  leave-to-class="opacity-0"
                >
                  <div v-if="matchError" class="animate-fade ml-4 pt-2 text-sm text-red-500">
                    <ExclamationTriangleIcon class="inline-block h-5 w-5" aria-hidden="true" /> Passwords do not match!
                  </div>
                </transition>
                <transition
                  enter-active-class="transform ease-out duration-300 transition"
                  enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
                  enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
                  leave-active-class="transition ease-in duration-300"
                  leave-from-class="opacity-100"
                  leave-to-class="opacity-0"
                >
                  <div v-if="changeSuccessful" class="animate-fade ml-4 pt-2 text-sm text-green-500">
                    <ShieldCheckIcon class="inline-block h-5 w-5" aria-hidden="true" /> Password changed successfully!
                  </div>
                </transition>
              </div>
            </form>
          </div>
          <div class="col-span-full sm:grid sm:grid-cols-3">
            <label for="timezone" class="mt-2 block px-6 py-4 text-sm font-medium leading-6 text-black dark:text-white"
              >Timezone</label
            >

            <div class="px-2 py-4">
              <!-- <select v-if="Selected == true" id="timezone" name="timezone" class="block w-full rounded-md border-0 bg-white/5 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 [&_*]:text-black">
                    <option v-for="time in timeZones"> 
                      {{ time }}
                    </option>
                  </select> -->

              <select
                required
                v-model="confirmTimeZone"
                id="timezone"
                name="timezone"
                class="mt-2 block w-full rounded-md border-0 bg-black/5 text-black shadow-sm ring-1 ring-inset ring-black/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-white/5 dark:text-white dark:ring-white/10 sm:text-sm sm:leading-6 [&_*]:text-black"
              >
                <option v-for="time in timeZones">
                  {{ time }}
                </option>
              </select>
            </div>
            <div class="mt-7 pr-10 text-right">
              <button
                type="button"
                @click="[setTimeZone(confirmTimeZone), console.log(confirmTimeZone)]"
                class="place-items-end text-sm font-semibold text-indigo-600 hover:text-indigo-500"
              >
                Update
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4 px-4 py-6 sm:px-6">
            <div>
              <dt class="text-sm font-medium text-black dark:text-white">API Tokens</dt>
              <p class="mt-1 text-sm leading-6 text-gray-400">
                Tokens authenticate external API calls with your permissions.
              </p>
            </div>
            <dd class="mt-1 flex text-sm leading-6 text-black dark:text-gray-200 sm:col-span-2 sm:mt-0">
              <span class="flex-grow"></span>
              <span class="mx-4 flex-shrink-0">
                <button
                  v-if="!tokenEdit"
                  type="button"
                  class="text-md font-semibold text-indigo-600 hover:text-indigo-500"
                  @click="tokenEdit = true"
                >
                  Create
                </button>
              </span>
            </dd>
            <div class="col-span-3">
              <form v-if="tokenEdit" class="mb-8 sm:max-w-xl" @submit.prevent="generateToken">
                <div class="grid grid-cols-1 gap-x-6 gap-y-8 sm:max-w-xl sm:grid-cols-6">
                  <div class="col-span-full">
                    <label for="token-name" class="block text-sm font-medium leading-6 text-black dark:text-white">
                      Token Name
                    </label>
                    <input
                      id="token-name"
                      v-model="tokenName"
                      required
                      type="text"
                      class="mt-1 block w-full rounded-md border-0 bg-black/5 py-1.5 text-black shadow-sm ring-1 ring-inset ring-black/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-white/5 dark:text-white dark:ring-white/10 sm:text-sm sm:leading-6"
                    />
                  </div>

                  <div class="col-span-full">
                    <label for="token-expires" class="block text-sm font-medium leading-6 text-black dark:text-white">
                      Expiration Date
                    </label>
                    <input
                      id="token-expires"
                      v-model="expirationDate"
                      required
                      type="date"
                      class="mt-1 block w-full rounded-md border-0 bg-black/5 py-1.5 text-black shadow-sm ring-1 ring-inset ring-black/10 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-white/5 dark:text-white dark:ring-white/10 dark:[color-scheme:dark] sm:text-sm sm:leading-6"
                    />
                  </div>
                </div>

                <div class="mt-8 flex">
                  <button
                    type="button"
                    class="mr-4 rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    @click="tokenEdit = false"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  >
                    Generate
                  </button>
                </div>
              </form>
              <div class="ml-16 overflow-x-auto sm:max-w-5xl">
                <table class="min-w-full divide-y divide-gray-700">
                  <thead>
                    <tr>
                      <th scope="col" class="px-3 py-3.5 text-left text-sm font-semibold text-black dark:text-white">
                        Token Name
                      </th>
                      <th scope="col" class="px-3 py-3.5 text-left text-sm font-semibold text-black dark:text-white">
                        Prefix
                      </th>
                      <th scope="col" class="px-3 py-3.5 text-left text-sm font-semibold text-black dark:text-white">
                        Expires
                      </th>
                      <th scope="col" class="px-3 py-3.5 text-left text-sm font-semibold text-black dark:text-white">
                        Last Used
                      </th>
                      <th scope="col" class="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span class="sr-only">Delete</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-800">
                    <tr v-if="sortedTokens.length === 0">
                      <td colspan="5" class="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">No tokens yet.</td>
                    </tr>
                    <tr v-for="token in sortedTokens" :key="token.id">
                      <td class="whitespace-nowrap px-3 py-4 text-sm text-black dark:text-white">{{ token.name }}</td>
                      <td class="whitespace-nowrap px-3 py-4 font-mono text-sm text-black dark:text-white">
                        {{ token.prefix }}...
                      </td>
                      <td class="whitespace-nowrap px-3 py-4 text-sm text-black dark:text-white">
                        {{ formatTokenDate(token.expiresAt) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-4 text-sm text-black dark:text-white">
                        {{ token.lastUsedAt ? formatTokenDate(token.lastUsedAt) : "Never" }}
                      </td>
                      <td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <button type="button" class="text-red-600 hover:text-red-900" @click="deleteTheToken(token.id)">
                          <TrashIcon class="h-5 w-5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="showPopup" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
              <div class="bg-gray-100 px-4 py-10 dark:bg-gray-900 sm:px-6 lg:px-8">
                <h1 class="text-base font-semibold leading-6 text-gray-800 dark:text-white">Token Center</h1>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  Your new access token is available below, press the clipboard icon to copy!
                </p>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  This window will only appear once! The token cannot be shown again.
                </p>
                <table class="mt-8 min-w-full divide-y divide-gray-700">
                  <thead>
                    <tr>
                      <th scope="col" class="px-3 py-3.5 text-left text-sm font-semibold text-gray-800 dark:text-white">
                        Token Code
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="whitespace-nowrap px-3 py-4 font-mono text-sm text-gray-800 dark:text-gray-300">
                        {{ myTokenName?.token }}
                      </td>
                      <td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <button
                          type="button"
                          class="text-green-600 hover:text-green-900"
                          @click="copyToClipboard(myTokenName?.token)"
                        >
                          <ClipboardDocumentCheckIcon class="h-5 w-5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <button
                  type="button"
                  class="mt-4 rounded bg-red-500 px-4 py-2 font-bold text-white hover:bg-red-700"
                  @click="showPopup = false"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
          <div class="col-span-full sm:grid sm:grid-cols-3">
            <label class="px-6 py-6 text-sm font-medium text-black dark:text-white">Theme</label>
            <fieldset class="mt-2">
              <legend class="sr-only">Notification method</legend>
              <div class="space-y-4 px-2 py-2 sm:flex sm:items-center sm:space-x-10 sm:space-y-0">
                <!-- <div v-for="notificationMethod in notificationMethods" :key="notificationMethod.id"
                  class="flex items-center">
                  <input :id="notificationMethod.id" name="notification-method" type="radio"
                    :checked="notificationMethod.id === 'light'" @click="toggleDarkMode(notificationMethod.id)"
                    class="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600" />
                  <label :for="notificationMethod.id" class="ml-3 block text-sm font-medium leading-6 text-white">{{
                    notificationMethod.title
                  }}</label>
                </div> -->
                <span class="isolate inline-flex rounded-md shadow-sm">
                  <ColorScheme placeholder="..." tag="span">
                    <button
                      type="button"
                      :class="[
                        $colorMode.preference === 'system' ? 'bg-indigo-700' : 'ring-gray-400',
                        'relative inline-flex items-center rounded-l-md  px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset hover:bg-gray-900/10 focus:z-10 dark:border-gray-700 dark:text-white dark:hover:bg-gray-50/5',
                      ]"
                      @click="[(colorMode.preference = 'system'), setTheme(1)]"
                    >
                      <ComputerDesktopIcon class="mr-2 h-5 w-5" />System
                    </button>

                    <button
                      type="button"
                      :class="[
                        $colorMode.preference === 'light' ? 'bg-indigo-600' : 'ring-gray-400',
                        'relative inline-flex items-center  px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset hover:bg-gray-900/10 focus:z-10 dark:border-gray-700 dark:text-white dark:hover:bg-gray-50/5',
                      ]"
                      @click="[(colorMode.preference = 'light'), setTheme(2)]"
                    >
                      <SunIcon class="mr-2 h-5 w-5" />Light
                    </button>
                    <button
                      type="button"
                      :class="[
                        $colorMode.preference === 'dark' ? 'bg-indigo-700' : 'ring-gray-400',
                        'relative inline-flex items-center rounded-r-md px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset hover:bg-gray-900/10 focus:z-10 dark:border-gray-700 dark:text-white dark:hover:bg-gray-50/5',
                      ]"
                      @click="[(colorMode.preference = 'dark'), setTheme(3)]"
                    >
                      <MoonIcon class="mr-2 h-5 w-5" />Dark
                    </button>
                  </ColorScheme>
                </span>
              </div>
            </fieldset>
          </div>
        </dl>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  TrashIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/vue/24/outline";
import { DateTime } from "luxon";
const colorMode = useColorMode();
const passwordEdit = ref(false);
const tokenEdit = ref(false);
console.log("Theme", colorMode);
const { data: currentUser } = await useFetch("/api/auth/currentUser");
const timeZones = Intl.supportedValuesOf("timeZone");
/// //Change Password
// const email = ref('')
const newPassword = ref("");
const confirmNewPassword = ref("");
const tokenName = ref("");
const showPopup = ref(false);
const myTokenName = ref(null);
const expirationDate = ref("");
const confirmTimeZone = ref(timeZones.at(currentUser.value.TimezoneId - 1));
/// Change User Theme Preference
async function setTheme(ThemeId) {
  try {
    const { error } = await useFetch("/api/users/edit", {
      method: "PUT",
      body: {
        id: currentUser.value.id,
        ThemeId,
      },
    });
    if (error.value != null) {
      console.log("Error Setting Theme");
    }
  } finally {
    // location.reload()
  }
}
async function setTimeZone() {
  try {
    console.log(confirmTimeZone);
    const { error } = await useFetch("/api/users/edit", {
      method: "PUT",
      body: {
        id: currentUser.value.id,
        timezone: confirmTimeZone,
      },
    });
    if (error.value != null) {
      console.log("TimeZone dose not exists");
    }
    // else{
    //     changeSuccessful.value = true
    setTimeout(() => location.reload(), 2000);
    // }
  } finally {
    // location.reload()
  }
}

const notificationMethods = [
  { id: "dark_mode", title: "Dark Mode" },
  { id: "light_mode", title: "Light Mode" },
];
var matchError = ref(false);
var changeSuccessful = ref(false);

async function setPassword(email, newPassword) {
  try {
    const { error } = await useFetch("/api/auth/setPW", {
      method: "POST",
      body: {
        email: email,
        password: newPassword,
      },
    });
    if (error.value != null) {
      console.log("Set Password Error");
    } else {
      changeSuccessful.value = true;
      setTimeout(() => location.reload(), 2000);
    }
  } finally {
    // location.reload()
  }
}

const { data: currentToken, refresh: refreshTokens } = await useFetch("/api/users/token");

const sortedTokens = computed(() => {
  if (!currentToken.value) {
    return [];
  }
  return currentToken.value
    .slice()
    .sort((a, b) => DateTime.fromISO(b.creationDate).toMillis() - DateTime.fromISO(a.creationDate).toMillis());
});

const formatTokenDate = (iso) => DateTime.fromISO(iso).toLocaleString(DateTime.DATE_MED);

async function generateToken() {
  if (!tokenName.value.trim() || !expirationDate.value) {
    return;
  }
  try {
    myTokenName.value = await $fetch("/api/users/token/create", {
      method: "POST",
      body: {
        name: tokenName.value,
        expiresAt: expirationDate.value,
      },
    });
    showPopup.value = true;
    tokenEdit.value = false;
    tokenName.value = "";
    expirationDate.value = "";
    await refreshTokens();
  } catch (error) {
    console.error("Token creation failed", error);
  }
}

//copy to clipboard
const copyToClipboard = async (text) => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  console.log("Text copied to clipboard", text);
};

// Logic for the delete method in the Tokens
const deleteTheToken = async (tokenId) => {
  const prevToken = [...currentToken.value];
  currentToken.value = currentToken.value.filter((token) => token.id !== tokenId);
  try {
    console.log("deleting the token with ID:", tokenId);

    const response = await fetch("/api/users/token/token", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: tokenId }),
    });
    const responseData = await response.json();
    if (!responseData.success) {
      console.error("token was NOT deleted..");
      currentToken.value = prevToken;
    }
  } catch (error) {
    console.error("Error: ", error);
    currentToken.value = prevToken;
  }
};

function checkPasswords() {
  if ((newPassword.value.length || confirmNewPassword.value.length) === 0) {
    console.log("Password cannot be empty");
  } else {
    if (newPassword.value === confirmNewPassword.value) {
      setPassword(currentUser.value.email, confirmNewPassword.value);
    } else {
      matchError.value = true;
      setTimeout(hideNotification, 3000);
    }
  }
}

function hideNotification() {
  matchError.value = false;
}
</script>
