const serverless = require("serverless-http");
require("dotenv").config();
const sql = require("mysql2/promise");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = express();
const cors = require("cors");

const pool = sql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.get("/api", (request, response) => {
  response.status(200).send({ message: "Hello from lambda!" });
});

app.post("/api", (request, response) => {
  try {
    response
      .status(200)
      .send({ message: `Your message was ${request.body.message}` });
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

app.post("/user", async (request, response) => {
  try {
    if (!request.body.username || !request.body.password)
      return response.status(401).send({ message: "Invalid credentials" });

    const username = request.body.username;
    const password = request.body.password;
    const role = request.body.role;
    //personal opinion: it is easier to understand the code if
    //the salt to a varialbe rather than type a number into the paramters
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);
    const conn = await pool.getConnection();
    const queryResponse = await conn.execute(
      `INSERT INTO recipes.user (username, password, role) VALUES (?, ?, ?)`,
      [username, hashedPassword, role]
    );
    conn.release();
    response.status(201).send(queryResponse);
  } catch (error) {
    console.log(error);
    response.status(500).send({ message: error });
  }
});

//login route works
app.post("/login", async (request, response) => {
  try {
    if (!request.body.username || !request.body.password)
      return response.status(401).send({ message: "invalid credentials" });

    const username = request.body.username;
    const password = request.body.password;
    const conn = await pool.getConnection();
    const queryResponse = await conn.execute(
      `SELECT * FROM recipes.user WHERE username = ?`,
      [username]
    );
    const fetchedUser = queryResponse[0][0];
    if (!fetchedUser)
      response.status(401).send({ message: "User does not exist" });
    else {
      if (await bcrypt.compare(password, fetchedUser.password)) {
        const username = fetchedUser.username;

        const jwtToken = jwt.sign(
          { username: username },
          process.env.SECRET_TOKEN
        );
        response
          .status(200)
          .send({ message: "successfully authenticated", jwt: jwtToken });
      } else {
        response.status(401).send({ message: "incorrect password" });
      }
    }
    console.log(fetchedUser);
    conn.release();
  } catch (error) {
    console.log(error);
    response.status(500).send({ message: error });
  }
});

app.post("/recipe", authorizeUser, async (request, response) => {
  try {
    //name, cooktime, pic, servings, instructions, ingredients
    if (
      !request.body.name ||
      !request.body.cooktime ||
      !request.body.servings ||
      !request.body.instructions ||
      !request.body.ingredients
    )
      return response.status(401).send({ message: "missing required field" });

    const name = request.body.name;
    const cooktime = request.body.cooktime;
    const pic = request.body.pic;
    const servings = request.body.servings;
    const instructions = request.body.instructions;
    const ingredients = request.body.ingredients;

    const decodedToken = request.decodedToken;
    //   console.log(decodedToken)
    const user = decodedToken.username;

    const conn = await pool.getConnection();
    const queryResponse = await conn.execute(
      `INSERT INTO recipes.recipe (name, cooktime, pic, user, servings, instructions, ingredients) VALUES (?,?,?,?,?,?,?)`,
      [name, cooktime, pic, user, servings, instructions, ingredients]
    );
    conn.release();
    response.status(201).send(queryResponse);
    response.sendStatus(200);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

app.post("/getrecipes", authorizeUser, async (request, response) => {
  try {
    console.log("POST ALL RECIPES");
    const conn = await pool.getConnection();
    const queryResponse = await conn.query(`SELECT * FROM recipes.recipe`);
    conn.release();
    const recipes = queryResponse[0];
    //The [0] above is to get the first item of the query response rather than returning
    //the whole array that comes in binary form.
    response.status(200).send(recipes);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

app.get("/allusers", async (request, response) => {
  console.log("GET ALL USERS");
  try {
    const conn = await pool.getConnection;
    const queryResponse = await conn.query(`SELECT * FROM recipes.user`);
    const users = queryResponse[0];
    response.status(200).send(users);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

app.post("/getuserrecipes", authorizeUser, async (request, response) => {
  console.log("GET ALL USERS RECIPES");
  try {
    const conn = await pool.getConnection();
    const queryResponse = await conn.query(
      `SELECT * FROM recipes.recipe WHERE user=?`,
      [username]
    );
    conn.release();
    const userRecipes = queryResponse[0];
    response.status(200).send(userRecipes);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

//Below is the share recipes route
//This is a hopeful route that I want to implement on the frontend

app.post("/sharerecipe", authorizeUser, async (request, response) => {
  try {
    if (!request.body.user || !request.body.recipeid)
      return response
        .status(401)
        .send({ message: "missing required information" });

    const user = request.body.user;
    const recipeid = request.body.recipeid;

    const decodedToken = request.decodedToken;
    console.log(decodedToken);

    const conn = await pool.getConnection();

    const checkForRecipe = await conn.execute(
      `SELECT user FROM recipes.recipe WHERE id = ?`,
      [recipeid]
    );

    console.log("checkForRecipe", checkForRecipe[0]);
    if (!(checkForRecipe[0][0].user === decodedToken.username)) {
      return response.status(403).send({ message: "Unauthorized" });
    }

    const queryResponse = await conn.execute(
      `INSERT INTO recipes.recipeconnections (user, recipeid) VALUES (?,?)`,
      [user, recipeid]
    );
    conn.release();
    response.status(201).send(queryResponse);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

app.post("/recipessharedwithme", authorizeUser, async (request, response) => {
  console.log("GET RECIPES SHARED WITH", request.decodedToken.username);
  try {
    const user = request.decodedToken.username;
    const conn = await pool.getConnection();

    const queryResponse = await conn.execute(
      `SELECT * FROM 
            (SELECT id, name, cootime, pic, servings, instructions, ingredients, RC.user AS user, FROM recipes.recipeconnections AS RC JOIN recipes.recipe AS RR ON RR.id = RC.recipeid)
             AS temp
             WHERE temp.user = ?`,
      [user]
    );

    const recipes = queryResponse[0];
    console.log(recipes);

    conn.release();
    response.status(201).send(recipes);
  } catch (error) {
    console.log(error);
    response.status(500).send(error);
  }
});

function authorizeUser(request, response, next) {
  const token = request.body.jwt;
  if (token == null) {
    console.log(token, "token is null");
    return response.status(401).send();
  }
  jwt.verify(token, process.env.SECRET_TOKEN, (err, decodedToken) => {
    if (err) return response.status(403).send();
    request.decodedToken = decodedToken;
    console.log("decoded token", decodedToken);
    next();
  });
}

// app.listen(4000, () => console.log("listening on 4000"));

module.exports.handler = serverless(app);
