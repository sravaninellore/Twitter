const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require("bcrypt");
const jsonwebtoken = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
let database = null;

app.use(express.json());

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// API - 1 ==> Register API

app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const userDetailsQuery = `SELECT * FROM user WHERE username = '${username}';`;

  const userDetails = await database.get(userDetailsQuery);

  if (userDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const addUserQuery = `
      INSERT INTO user (name, username, password, gender)
      VALUES
         (
          '${name}',
          '${username}',
          '${hashedPassword}',
          '${gender}'
         );
    `;

    const dBResponse = await database.run(addUserQuery);
    const newUserId = dBResponse.lastID;

    console.log(newUserId);

    response.status(200);
    response.send("User created successfully");
  }
});

// API - 2 ==> Login API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const userQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(userQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { username: username, user_id: dbUser.user_id };
      const jwtToken = jsonwebtoken.sign(payload, "12345678910");
      response.send({ jwtToken });
    }
  }
});

// Verifying JWT Token using `authenticateToken` function

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jsonwebtoken.verify(jwtToken, "12345678910", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user_id = payload.user_id;
        request.username = payload.username;
        next();
      }
    });
  }
};

// API - 3 ==> Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const userFeedQuery = `
    SELECT 
        username,
        tweet,
        date_time AS dateTime
    FROM
        user INNER JOIN follower
          ON user.user_id = follower.following_user_id
        INNER JOIN tweet 
          ON user.user_id = tweet.user_id
    WHERE follower_user_id = ${userId}
    ORDER BY 
        date_time DESC
    LIMIT 4;
  `;

  const dbResponse = await database.all(userFeedQuery);
  response.send(dbResponse);
});

// API - 4 ==> Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const followedUsersQuery = `
    SELECT 
        name
    FROM user JOIN follower
      ON user.user_id = follower.following_user_id 
    WHERE
        follower_user_id = ${userId};
  `;

  const followedUsers = await database.all(followedUsersQuery);
  response.send(followedUsers);
});

// API - 5 ==> Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const followerUsersQuery = `
    SELECT 
        name
    FROM
        user JOIN follower
      ON user.user_id = follower.follower_user_id
    WHERE
        following_user_id = ${userId};      
  `;

  const dbResponse = await database.all(followerUsersQuery);
  response.send(dbResponse);
});

// isFollowing Middleware function ==> If the user requests a tweet other than the users he is following

const isFollowing = async (request, response, next) => {
  const { tweetId } = request.params;
  const userId = request.user_id;

  const followedUsersQuery = `
        SELECT 
            user_id
        FROM
            user INNER JOIN follower
          ON user.user_id = follower.following_user_id
        WHERE 
            follower_user_id = ${userId};   
    `;

  const followedUsers = await database.all(followedUsersQuery);

  const tweetUserQuery = `
        SELECT 
            user_id
        FROM 
            tweet
        WHERE
            tweet_id = ${tweetId};
    `;

  const tweetUser = await database.get(tweetUserQuery);
  const tweetUserId = tweetUser.user_id;

  // console.log(tweetUser);
  // console.log(tweetUser.user_id);

  const isFollowing = followedUsers.some(
    (eachUser) => eachUser.user_id === tweetUserId
  );

  //   console.log(isFollowing);

  if (isFollowing === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// API - 6 ==> If the user requests a tweet of the user he is following,
//              return the tweet, likes count, replies count and date-time

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const query = `
        SELECT 
            tweet,
            COUNT(like.tweet_id) AS likes,
            (
                SELECT COUNT(reply.tweet_id)
                FROM (tweet
                    JOIN reply
                ON tweet.tweet_id = reply.tweet_id)
                WHERE
                tweet.tweet_id = ${tweetId}
            ) AS replies,
            date_time AS dateTime
        FROM tweet
           JOIN like
          ON tweet.tweet_id = like.tweet_id
        WHERE
            tweet.tweet_id = ${tweetId};
    `;

    const dbResponse = await database.get(query);

    response.send(dbResponse);
  }
);

// API - 7 ==> If the user requests a tweet of a user he is following,
//              return the list of usernames who liked the tweet

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const getTweetLikedUsers = `
        SELECT
            username
        FROM 
            user
        WHERE user_id IN
            (
                SELECT 
                    like.user_id
                FROM
                    tweet JOIN like
                  ON tweet.tweet_id = like.tweet_id
                WHERE 
                    tweet.tweet_id = ${tweetId}
            );
      `;

    const tweetLikedUsers = await database.all(getTweetLikedUsers);

    const likedUsers = [];

    tweetLikedUsers.map((eachUser) => likedUsers.push(eachUser.username));

    // console.log(likedUsers);

    response.send({
      likes: likedUsers,
    });
  }
);

// API - 8 ==> If the user requests a tweet of a user he is following,
//              return the list of replies.

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const getRepliedUsers = `
        SELECT
            user.name, reply
        FROM
            tweet JOIN reply
          ON tweet.tweet_id = reply.tweet_id
            JOIN user 
          ON reply.user_id = user.user_id
        WHERE
            tweet.tweet_id = ${tweetId};
    `;

    const repliedUsers = await database.all(getRepliedUsers);
    response.send({ replies: repliedUsers });
  }
);

// API - 9 ==> Returns a list of all tweets of the user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const getUserTweets = `
      SELECT
          tweet,
          COUNT(like.tweet_id) AS likes,
          (
              SELECT 
                COUNT(reply.tweet_id)
              FROM
                tweet JOIN reply 
               ON tweet.tweet_id = reply.tweet_id
              WHERE
                tweet.user_id = ${userId}
              GROUP BY 
                reply.tweet_id
          ) AS replies,
          date_time AS dateTime
      FROM
          tweet JOIN like
        ON tweet.tweet_id = like.tweet_id
      WHERE
        tweet.user_id = ${userId}
      GROUP BY
        like.tweet_id;
    `;

  const userTweets = await database.all(getUserTweets);

  response.send(userTweets);
});

// API - 10 ==> Create a tweet in the tweet table

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = request.user_id;

  const createTweetQuery = `
    INSERT INTO tweet
        (tweet, user_id, date_time)
    VALUES
        ('${tweet}', ${userId}, '2022-09-06');
    `;

  const addTweet = await database.run(createTweetQuery);
  const addTweetId = addTweet.lastID;
  //   console.log(addTweetId);
  response.send("Created a Tweet");
});

// API - 11 ==> Delete a tweet in the tweet table

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userId = request.user_id;

    const getTweet = `
        SELECT 
            *
        FROM
            tweet
        WHERE 
            tweet_id = ${tweetId};
    `;

    const tweet = await database.get(getTweet);
    const tweetUserId = tweet.user_id;

    // If the user requests to delete a tweet of other users

    if (tweetUserId !== userId) {
      response.status(401);
      response.send("Invalid Request");
    }

    // If the user deletes his tweet
    else {
      const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE tweet_id = ${tweetId};
        `;

      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
