<script lang="ts">
    import axios from "axios";
    import { onMount } from "svelte";

    // @ts-ignore
    import {
        Modal,
        Button,
        Portal,
        Field,
        Checkbox,
        Text,
    } from "wx-svelte-core";

    import { SvelteToast } from "@zerodevx/svelte-toast";
    import { toast_failure, toast_success } from "./toast";

    let baseUrl = "";
    let proxyUrl = "";
    if (import.meta.env.MODE === "development") {
        proxyUrl = "http://localhost:8080/api";
        baseUrl = "http://localhost:8080";
    } else {
        proxyUrl =
            "https://lyo-inventory-proxy-x79b.onrender.com/api";
        baseUrl = "https://lyo-inventory-proxy-x79b.onrender.com";
    }
    let { shown = $bindable() } = $props();
    let isAdmin = $state(false);
    let token = "";
    let users = $state([]);
    let current_user = sessionStorage.getItem("username");

    let screen: "accountcfg" | "newaccount" = $state("accountcfg");

    onMount(async () => {
        isAdmin = sessionStorage.getItem("isadmin") == "true";
        token = sessionStorage.getItem("token") || "";

        if (isAdmin) {
            users = await getUsers();
        }
    });

    async function getUsers() {
        let resp = await axios.get(`${baseUrl}/all-accounts`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        // let j = JSON.parse(resp.data)

        return resp.data;
    }

    let new_username = $state("");
    let new_password = $state("");
    let new_isadmin = $state(false);

    async function deleteAccount(uname: string) {
        if (
            confirm(`Xóa tài khoản ${uname}? Thao tác này không thể hoàn tác.`)
        ) {
            let a = await axios.delete(`${baseUrl}/account`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                params: {
                    userid: uname,
                },
            });

            if (a.status == 200) {
                toast_success("Đã xóa người dùng!");
                users = await getUsers();
            } else {
                toast_success(`Đã phát sinh lỗi: ${a.statusText}`);
            }
        }
    }

    async function changeAccountPassword(uname: string) {
        console.log(uname, current_user);
        if (uname == current_user) {
            const old_pwd = prompt("Nhập lại mật khẩu cũ");
            if (!old_pwd) {
                return
            }
            const v = await axios.post(
                `${baseUrl}/auth`,
                {
                    username: uname,
                    password: old_pwd,
                },
                {
                    params: {
                        verifyOnly: "true",
                    },
                },
            ).catch((reason) => {
                toast_failure("Mật khẩu không chính xác")
                return
            });

            if (v.status == 200) {
                const new_pwd = prompt("Nhập mật khẩu mới");
                if (new_pwd) {
                    let a = await axios.patch(
                        `${baseUrl}/account`,
                        JSON.stringify({ username: uname, password: new_pwd }),
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        },
                    );

                    if (a.status == 200) {
                        toast_success("Đặt lại mật khẩu thành công!");
                    } else {
                        toast_success(`Đã phát sinh lỗi: ${a.statusText}`);
                        return
                    }
                } else {
                    toast_failure("Mật khẩu không được để trống.");
                    return
                }
            } else {
                toast_failure("Mật khẩu không chính xác");
                return
            }
        } else {
            const new_pwd = prompt("Mật khẩu mới");
            if (new_pwd) {
                let a = await axios.patch(
                    `${baseUrl}/account`,
                    JSON.stringify({ username: uname, password: new_pwd }),
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    },
                );

                if (a.status == 200) {
                    toast_success("Đặt lại mật khẩu thành công!");
                } else {
                    toast_success(`Đã phát sinh lỗi: ${a.statusText}`);
                }
            } else {
                toast_failure("Mật khẩu không được để trống.");
            }
        }
    }

    async function createNewAccount() {
        if (new_password == "" || new_username == "") {
            toast_failure("Username hoặc Mật khẩu trống");
            return -1;
        }

        // @ts-ignore
        if (
            users.some((v) => {
                return new_username == v.username;
            })
        ) {
            toast_failure("Username đã tồn tại");
            return -1;
        }

        const endpoint = new_isadmin ? "admin-account" : "account";

        let a = await axios.post(
            `${baseUrl}/${endpoint}`,
            JSON.stringify({ username: new_username, password: new_password }),
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
        );

        if (a.status == 200) {
            toast_success("Đã tạo tài khoản mới");
            return 0;
        } else {
            toast_failure(`Phát sinh lỗi khi tạo tài khoản: ${a.statusText}`);
            return -1;
        }
    }

    async function handleConfirm() {
        if (screen === "newaccount") {
            const r = await createNewAccount();
            if (r == 0) {
                users = await getUsers();
                screen = "accountcfg";
                return;
            }
        } else {
            shown = false;
            new_isadmin = false;
            new_password = "";
            new_username = "";
        }
    }

    function handleCancel() {
        if (screen === "newaccount") {
            screen = "accountcfg";
            return;
        }
        shown = false;
        new_isadmin = false;
        new_password = "";
        new_username = "";
    }
</script>

<SvelteToast />

<div>
    <Modal
        buttons={["ok", "cancel"]}
        onconfirm={handleConfirm}
        oncancel={handleCancel}
        title="Cài đặt"
        class="settings-modal"
    >
        {#if screen == "accountcfg"}
            <div style="text-align: left;">
                <!-- <h2>Cài đặt</h2> -->

                <Field width="500px" label="">
                    <p><b>Username:</b> {current_user}</p>
                    <Button onclick={async () => {await changeAccountPassword(current_user)}} type="secondary">Đổi mật khẩu</Button>

                </Field>

                {#if isAdmin}
                    <Field
                        label="Quản lí tài khoản"
                        width="500px"
                        height="500px"
                    >
                        <Button
                            onclick={() => {
                                screen = "newaccount";
                            }}
                            icon="mdi mdi-plus"
                            type="block">Tạo tài khoản</Button
                        >
                        <div
                            style="margin-top: 10px; text-align: left; width: 100%; height: 250px; max-height: 250px; overflow-y: scroll"
                        >
                            <table
                                style="width:100%; border: 1px solid #e3e3e3; border-collapse: collapse"
                            >
                                <thead>
                                    <tr>
                                        <td
                                            style="padding: 5px; background-color: #e3e3e3; width: calc(100% - 250px)"
                                            >Username</td
                                        >
                                        <td
                                            style="padding: 5px; background-color: #e3e3e3; width: 32px"
                                            >Admin?</td
                                        >
                                        <td
                                            style="padding: 5px; background-color: #e3e3e3; width: 90px"
                                            >Hành động</td
                                        >
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each users as user}
                                        <tr>
                                            {#if current_user == user.username}
                                                <td
                                                    style="border: 1px solid #e3e3e3; padding: 5px"
                                                    ><b>{user.username} (Bạn)</b
                                                    ></td
                                                >
                                            {/if}

                                            {#if current_user != user.username}
                                                <td
                                                    style="border: 1px solid #e3e3e3; padding: 5px"
                                                    >{user.username}</td
                                                >
                                            {/if}

                                            {#if user.isadmin}
                                                <td
                                                    style="border: 1px solid #e3e3e3; padding: 5px"
                                                >
                                                    <i class="mdi mdi-check"
                                                    ></i>
                                                </td>
                                            {/if}
                                            {#if !user.isadmin}
                                                <td
                                                    style="border: 1px solid #e3e3e3; padding: 5px"
                                                ></td>
                                            {/if}
                                            <td
                                                style="border: 1px solid #e3e3e3; padding: 5px"
                                            >
                                                <Button
                                                    type=""
                                                    title="Đổi mật khẩu"
                                                    icon="mdi mdi-form-textbox-password"
                                                    onclick={async () => {
                                                        await changeAccountPassword(
                                                            user.username,
                                                        );
                                                    }}
                                                ></Button>
                                                {#if user.username != current_user}
                                                    <Button
                                                        type="danger"
                                                        title="Xóa"
                                                        icon="mdi mdi-delete"
                                                        onclick={async () => {
                                                            await deleteAccount(
                                                                user.username,
                                                            );
                                                        }}
                                                    ></Button>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    </Field>
                {/if}
            </div>
        {/if}

        <!-- New account screen -->
        {#if screen == "newaccount"}
            <div
                style="display: flex; gap: 10px; text-align: center; flex-direction: column"
            >
                <h2>Tài khoản mới</h2>
                <Text
                    bind:value={new_username}
                    placeholder="Username"
                    autocomplete="off"
                ></Text>
                <Text bind:value={new_password} placeholder="Mật khẩu"></Text>

                <Checkbox bind:value={new_isadmin} label="Admin?"></Checkbox>
            </div>
        {/if}
    </Modal>
</div>

<style>
    .wx-window {
        width: 100%;
        max-width: 700px;
    }
</style>
